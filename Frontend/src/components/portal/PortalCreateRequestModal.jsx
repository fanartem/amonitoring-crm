import React, { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../../api'
import {
	canCreatePortalSubclient,
	canViewPortalPrices,
	canViewPortalSubclients,
	getStoredUser,
} from '../../utils/access'
import './styles/PortalModal.css'

// Создание заявки клиентом.
//
// Клиент выбирает только то, что знает сам: организацию, время, город,
// адрес, машины и комментарий. Вид работ, платформа, трекер, подписки,
// блокировка, маяк, датчики и тип выезда приходят из параметров установки
// договора — их показываем, но не даём менять. Цену считает сервер.
//
// Все проверки продублированы на бэкенде. Здесь они нужны только чтобы
// человек не отправлял форму ради того, чтобы получить отказ.

const TIME_START_MINUTES = 8 * 60
const TIME_END_MINUTES = 20 * 60
const TIME_STEP_MINUTES = 30

// Рабочее время из requests.py: пн–пт, 10:00–17:30 включительно.
// Вне его заявка уходит на согласование и требует причины.
const WORK_DAY_START_MINUTES = 10 * 60
const WORK_DAY_END_MINUTES = 17 * 60 + 30

const MAX_VEHICLES = 50
const VEHICLE_SEARCH_DEBOUNCE_MS = 350

// Запас на дорогу из requests.py (VISIT_MINIMUM_LEAD_MINUTES).
// Раньше это правило знал только сервер, и клиент спокойно выбирал
// время, на котором заявка потом падала.
const VISIT_MINIMUM_LEAD_MINUTES = {
	ON_SITE_CITY: 25,
	ON_SITE_OUTSIDE_CITY: 120,
	BUSINESS_TRIP_KM: 300,
}

// Как часто пересчитываем «ближайшее доступное время». Форму заполняют
// долго, и без этого через полчаса список времени снова разойдётся
// с сервером.
const CLOCK_TICK_MS = 60 * 1000

const VISIT_TYPE_LABELS = {
	IN_OFFICE: 'В офисе',
	ON_SITE: 'Выезд к клиенту',
}

const VISIT_PRICE_LABELS = {
	ON_SITE_CITY: 'по городу',
	ON_SITE_OUTSIDE_CITY: 'за городом',
}

const CLIENT_TYPES = [
	{ value: 'TOO', label: 'ТОО' },
	{ value: 'IP', label: 'ИП' },
	{ value: 'INDIVIDUAL', label: 'Физическое лицо' },
]

const COMPANY_TYPES = ['TOO', 'IP']

const EMPTY_NEW_CLIENT = {
	type: 'TOO',
	name: '',
	company_name: '',
	phone: '',
	email: '',
	bin_iin: '',
}

const buildTimeOptions = () => {
	const options = []

	for (
		let minutes = TIME_START_MINUTES;
		minutes <= TIME_END_MINUTES;
		minutes += TIME_STEP_MINUTES
	) {
		const hours = String(Math.floor(minutes / 60)).padStart(2, '0')
		const rest = String(minutes % 60).padStart(2, '0')

		options.push(`${hours}:${rest}`)
	}

	return options
}

const TIME_OPTIONS = buildTimeOptions()

// Сервер живёт во времени Алматы. Брать локальное время браузера нельзя:
// у клиента в другом часовом поясе «сегодня» и «сейчас» окажутся другими,
// и форма разрешит то, что сервер отклонит.
const getAlmatyNow = () => {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Almaty',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	})

	const parts = Object.fromEntries(
		formatter
			.formatToParts(new Date())
			.filter(part => part.type !== 'literal')
			.map(part => [part.type, part.value]),
	)

	return {
		date: `${parts.year}-${parts.month}-${parts.day}`,
		minutes: Number(parts.hour) * 60 + Number(parts.minute),
	}
}

const addDays = (dateString, days) => {
	const [year, month, day] = dateString.split('-').map(Number)
	const date = new Date(Date.UTC(year, month - 1, day))

	date.setUTCDate(date.getUTCDate() + days)

	return [
		date.getUTCFullYear(),
		String(date.getUTCMonth() + 1).padStart(2, '0'),
		String(date.getUTCDate()).padStart(2, '0'),
	].join('-')
}

const minutesToTime = minutes =>
	`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
		minutes % 60,
	).padStart(2, '0')}`

const timeToMinutes = value => {
	const match = String(value || '').match(/^(\d{2}):(\d{2})$/)

	if (!match) return null

	return Number(match[1]) * 60 + Number(match[2])
}

const formatDateForHuman = dateString => {
	const [year, month, day] = String(dateString || '').split('-')

	return year ? `${day}.${month}.${year}` : ''
}

/**
 * Ближайшее время, которое примет сервер.
 *
 * Повторяет get_next_available_schedule_slot из requests.py: «сейчас плюс
 * запас на дорогу», округление вверх до получаса, окно 08:00-20:00.
 * Ровно то же считает validate_request_schedule, поэтому форма запрещает
 * не больше и не меньше сервера.
 */
const computeEarliestSlot = (visitType, visitPriceCode) => {
	const now = getAlmatyNow()

	const leadMinutes =
		visitType === 'ON_SITE'
			? (VISIT_MINIMUM_LEAD_MINUTES[visitPriceCode] ??
				VISIT_MINIMUM_LEAD_MINUTES.ON_SITE_CITY)
			: 0

	let date = now.date
	let minutes = now.minutes + leadMinutes

	while (minutes >= 24 * 60) {
		minutes -= 24 * 60
		date = addDays(date, 1)
	}

	if (minutes % TIME_STEP_MINUTES !== 0) {
		minutes += TIME_STEP_MINUTES - (minutes % TIME_STEP_MINUTES)
	}

	if (minutes >= 24 * 60) {
		minutes -= 24 * 60
		date = addDays(date, 1)
	}

	if (minutes < TIME_START_MINUTES) {
		minutes = TIME_START_MINUTES
	} else if (minutes > TIME_END_MINUTES) {
		date = addDays(date, 1)
		minutes = TIME_START_MINUTES
	}

	return { date, minutes, time: minutesToTime(minutes) }
}

// Собираем строку без часового пояса: сервер работает во времени Алматы
// и ждёт «голую» дату. toISOString() перевёл бы её в UTC и сдвинул на часы.
const buildScheduledAt = (dateValue, timeValue) => {
	if (!dateValue || !timeValue) return null

	return `${dateValue}T${timeValue}:00`
}

const isWorkingScheduleTime = (dateValue, timeValue) => {
	if (!dateValue || !timeValue) return true

	const parsed = new Date(`${dateValue}T${timeValue}:00`)

	if (Number.isNaN(parsed.getTime())) return true

	const weekday = parsed.getDay()

	if (weekday === 0 || weekday === 6) return false

	const minutes = parsed.getHours() * 60 + parsed.getMinutes()

	return minutes >= WORK_DAY_START_MINUTES && minutes <= WORK_DAY_END_MINUTES
}

const formatMoney = value => {
	const number = Number(value || 0)

	if (Number.isNaN(number)) return '—'

	return `${number.toLocaleString('ru-RU')} тг`
}

const getVehicleLabel = vehicle => {
	const title =
		`${vehicle.brand || ''} ${vehicle.model || ''}`.trim() || 'Автомобиль'
	const plate = vehicle.plate_number || 'б/н'

	return `${title} (${plate})${vehicle.vin ? ` · ${vehicle.vin}` : ''}`
}

const createEmptyRow = () => ({
	key: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	// По умолчанию новое ТС: в кабинете заявку чаще оформляют на машину,
	// которой в системе ещё нет. Повторное обслуживание — второй случай,
	// и для него есть вкладка рядом.
	mode: 'new',
	vehicle: null,
	vin: '',
	brand: '',
	model: '',
	plate_number: '',
	year: '',
	type: '',
})

// --------------------------------------------------------------------------
// Выбор существующей машины.
//
// Поиск уходит на сервер, а не фильтрует загруженный список: у крупного
// клиента машин больше, чем разумно тянуть в браузер, и обрезанный список
// молча врал бы «ничего не найдено».
// --------------------------------------------------------------------------
function VehiclePicker({ clientId, excludeIds, value, onChange }) {
	const [query, setQuery] = useState('')
	const [options, setOptions] = useState([])
	const [loading, setLoading] = useState(false)
	const [isOpen, setIsOpen] = useState(false)

	const closeTimer = useRef(null)

	useEffect(() => {
		if (!isOpen) return

		const timeout = setTimeout(() => {
			fetchOptions(query)
		}, VEHICLE_SEARCH_DEBOUNCE_MS)

		return () => clearTimeout(timeout)
	}, [query, isOpen, clientId])

	useEffect(() => () => clearTimeout(closeTimer.current), [])

	const fetchOptions = async searchValue => {
		setLoading(true)

		try {
			const params = new URLSearchParams({ limit: '10', offset: '0' })

			if (clientId) params.set('client_id', String(clientId))
			if (searchValue.trim()) params.set('q', searchValue.trim())

			const res = await fetch(`${API_BASE_URL}/portal/vehicles?${params}`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				setOptions([])
				return
			}

			const data = await res.json()

			setOptions(Array.isArray(data.items) ? data.items : [])
		} catch {
			setOptions([])
		} finally {
			setLoading(false)
		}
	}

	const visibleOptions = options.filter(
		option => !excludeIds.includes(Number(option.id)),
	)

	if (value) {
		return (
			<div className='pm-picked'>
				<span className='pm-picked-text'>{getVehicleLabel(value)}</span>

				<button
					type='button'
					className='pm-link'
					onClick={() => onChange(null)}
				>
					Изменить
				</button>
			</div>
		)
	}

	return (
		<div className='pm-picker'>
			<input
				className='pm-input'
				value={query}
				placeholder='Марка, госномер или VIN...'
				onChange={e => setQuery(e.target.value)}
				onFocus={() => {
					clearTimeout(closeTimer.current)
					setIsOpen(true)
				}}
				onBlur={() => {
					// Задержка нужна, иначе blur закроет список раньше,
					// чем сработает клик по строке.
					closeTimer.current = setTimeout(() => setIsOpen(false), 180)
				}}
			/>

			{isOpen && (
				<div className='pm-dropdown'>
					{loading ? (
						<div className='pm-dropdown-empty'>Поиск...</div>
					) : visibleOptions.length === 0 ? (
						<div className='pm-dropdown-empty'>
							Ничего не найдено. Добавьте ТС как новое.
						</div>
					) : (
						visibleOptions.map(option => (
							<button
								key={option.id}
								type='button'
								className='pm-dropdown-row'
								onMouseDown={e => e.preventDefault()}
								onClick={() => {
									onChange(option)
									setIsOpen(false)
									setQuery('')
								}}
							>
								{getVehicleLabel(option)}
							</button>
						))
					)}
				</div>
			)}
		</div>
	)
}

// --------------------------------------------------------------------------

export default function PortalCreateRequestModal({ onClose, onCreated }) {
	const currentUser = getStoredUser()

	const canSeePrices = canViewPortalPrices(currentUser)
	const hasOrgSection = canViewPortalSubclients(currentUser)
	const canCreateOrg = canCreatePortalSubclient(currentUser)

	const [clients, setClients] = useState([])
	const [ownClientId, setOwnClientId] = useState(null)
	const [clientsLoaded, setClientsLoaded] = useState(false)

	const [orgMode, setOrgMode] = useState('existing')
	const [selectedClientId, setSelectedClientId] = useState('')
	const [newClient, setNewClient] = useState(EMPTY_NEW_CLIENT)

	// Организация создаётся до заявки отдельным запросом. Если заявка
	// потом не пройдёт, организация уже существует — второй раз её
	// создавать нельзя, иначе получим дубль. Запоминаем и переиспользуем.
	const [createdClient, setCreatedClient] = useState(null)

	const [cities, setCities] = useState([])

	const [settings, setSettings] = useState(null)
	const [settingsLoading, setSettingsLoading] = useState(false)

	const [dateValue, setDateValue] = useState('')
	const [timeValue, setTimeValue] = useState('')
	const [city, setCity] = useState('')
	const [address, setAddress] = useState('')
	const [comment, setComment] = useState('')
	const [approvalReason, setApprovalReason] = useState('')

	// Контактное лицо заявки: кого встретит монтажник. Отдельно от
	// карточки организации — там обычно бухгалтер или директор,
	// а на объекте машину показывает водитель или завгар.
	const [contactName, setContactName] = useState('')
	const [contactPhone, setContactPhone] = useState('')

	// Пока клиент не тронул поля руками, они следуют за организацией.
	const [contactTouched, setContactTouched] = useState(false)

	const [rows, setRows] = useState([createEmptyRow()])

	const [error, setError] = useState('')

	// Счётчик показов ошибки. Нужен, чтобы прокрутка сработала и когда
	// текст ошибки повторился: сам по себе error тогда не меняется,
	// а пользователь уже мог уйти вниз формы.
	const [errorNonce, setErrorNonce] = useState(0)

	const [submitting, setSubmitting] = useState(false)

	const bodyRef = useRef(null)

	// Секции формы: к ним прокручиваем, когда ошибка относится к одной
	// из них. Общая ошибка (отказ сервера, ненастроенный договор) уводит
	// наверх, к баннеру.
	const orgSectionRef = useRef(null)
	const scheduleSectionRef = useRef(null)
	const vehiclesSectionRef = useRef(null)
	const contactSectionRef = useRef(null)

	const [errorAnchor, setErrorAnchor] = useState('top')

	// Идентификатор поля, на котором споткнулась проверка. Отдельно от
	// текста ошибки: сообщение отвечает «что не так», подсветка —
	// «где именно». На форме в полсотни полей одного текста мало.
	const [errorField, setErrorField] = useState(null)

	const showError = (message, anchor = 'top', field = null) => {
		setError(message)
		setErrorAnchor(anchor)
		setErrorField(field)
		setErrorNonce(value => value + 1)
	}

	// Подсветку снимаем, как только человек начал править именно это поле.
	// Баннер оставляем: он уйдёт при следующей отправке или по крестику.
	const clearFieldError = field =>
		setErrorField(prev => (prev === field ? null : prev))

	const fieldClass = (base, field) =>
		errorField === field ? `${base} pm-invalid` : base

	// Один обработчик на всё тело формы вместо onChange в каждом из
	// полутора десятков полей: подсветка снимается, как только начали
	// править именно то поле, на которое ругались.
	const handleFieldInput = event => {
		if (event.target?.classList?.contains('pm-invalid')) {
			setErrorField(null)
		}
	}

	const vehicleFieldName = (row, field) => `vehicle.${row.key}.${field}`

	const vehicleHasError = row =>
		typeof errorField === 'string' &&
		errorField.startsWith(`vehicle.${row.key}.`)

	const scrollToAnchor = anchor => {
		const body = bodyRef.current

		if (!body) return

		// Поле важнее секции: если знаем конкретный input, ведём к нему.
		const invalidNode = body.querySelector('.pm-invalid, .pm-card-invalid')

		const sectionNode =
			anchor === 'org'
				? orgSectionRef.current
				: anchor === 'schedule'
					? scheduleSectionRef.current
					: anchor === 'contact'
						? contactSectionRef.current
						: anchor === 'vehicles'
							? vehiclesSectionRef.current
							: null

		// Скобки здесь обязательны: без них || связывает сильнее тернарника,
		// условием становится «поле найдено ИЛИ якорь org», и любое найденное
		// поле уводило прокрутку к секции организации — а её у клиента без
		// подклиентов нет вовсе, и форма прыгала в самый верх.
		const target = invalidNode || sectionNode

		if (!target) {
			body.scrollTo({ top: 0, behavior: 'smooth' })
			return
		}

		// offsetTop не годится: у .pm-body нет position, и точкой отсчёта
		// оказался бы overlay. Считаем смещение через прямоугольники.
		const offset =
			target.getBoundingClientRect().top -
			body.getBoundingClientRect().top +
			body.scrollTop

		// К полю подводим с большим запасом: сверху висит липкий баннер
		// с ошибкой, и без отступа он бы закрыл подпись поля.
		const padding = invalidNode ? 96 : 12

		body.scrollTo({ top: Math.max(offset - padding, 0), behavior: 'smooth' })
	}

	// Баннер с ошибкой стоит первым в теле формы. Форма длинная, кнопка
	// «Создать заявку» — внизу, и без прокрутки нажатие выглядит так,
	// будто ничего не произошло.
	useEffect(() => {
		if (!error) return

		scrollToAnchor(errorAnchor)
	}, [errorNonce, error, errorAnchor, errorField]) // eslint-disable-line react-hooks/exhaustive-deps

	// Тикающие часы: от них зависит список доступного времени.
	const [clockTick, setClockTick] = useState(0)

	useEffect(() => {
		const intervalId = setInterval(
			() => setClockTick(value => value + 1),
			CLOCK_TICK_MS,
		)

		return () => clearInterval(intervalId)
	}, [])

	// Своя организация в списке не участвует: заявки из кабинета
	// оформляются на организации структуры, а не на головную.
	const subclients = useMemo(
		() => clients.filter(item => Number(item.id) !== Number(ownClientId)),
		[clients, ownClientId],
	)

	// Чья организация станет клиентом заявки.
	// null означает «своя» — так его понимает сервер.
	const targetClientId = createdClient
		? createdClient.id
		: hasOrgSection
			? orgMode === 'existing' && selectedClientId
				? Number(selectedClientId)
				: null
			: null

	// Для новой организации параметры показываем свои: новая организация
	// наследует их от родителя, а родитель — это мы.
	const settingsReady =
		!hasOrgSection ||
		Boolean(createdClient) ||
		orgMode === 'new' ||
		Boolean(selectedClientId)

	// Существующие ТС есть только у существующей организации.
	const vehiclesClientId = createdClient
		? createdClient.id
		: hasOrgSection
			? orgMode === 'existing' && selectedClientId
				? Number(selectedClientId)
				: null
			: ownClientId

	const allowExistingVehicles = Boolean(vehiclesClientId)

	useEffect(() => {
		fetchClients()
		fetchCities()
	}, [])

	useEffect(() => {
		if (!settingsReady) {
			setSettings(null)
			return
		}

		fetchSettings(targetClientId)
	}, [settingsReady, targetClientId, orgMode])

	useEffect(() => {
		// Машины принадлежат конкретной организации: при её смене
		// прежний выбор перестаёт быть верным.
		setRows([createEmptyRow()])
	}, [targetClientId, orgMode])

	useEffect(() => {
		if (allowExistingVehicles) return

		// Организации ещё нет — значит и машин у неё нет.
		setRows(prev =>
			prev.map(row =>
				row.mode === 'existing' ? { ...row, mode: 'new', vehicle: null } : row,
			),
		)
	}, [allowExistingVehicles])

	const readError = async (res, fallback) => {
		const data = await res.json().catch(() => null)
		const detail = data?.detail

		if (typeof detail === 'string' && detail.trim()) return detail

		// При 422 FastAPI отдаёт detail массивом объектов вида
		// {loc, msg, type}. Прежний код передавал этот массив в Error,
		// и пользователь видел «[object Object]» вместо причины.
		if (Array.isArray(detail)) {
			const text = detail
				.map(item => {
					const field = Array.isArray(item?.loc)
						? item.loc.filter(part => part !== 'body').join(' → ')
						: ''

					const message = item?.msg || item?.detail || ''

					return [field, message].filter(Boolean).join(': ')
				})
				.filter(Boolean)
				.join('; ')

			return text || fallback
		}

		return fallback
	}

	const fetchClients = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/portal/clients`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) return

			const data = await res.json()

			const items = Array.isArray(data.items) ? data.items : []
			const own = data.own_client_id ?? null

			setClients(items)
			setOwnClientId(own)

			// Структура пуста — предлагать «выбрать из существующих» нечего.
			const hasSubclients = items.some(item => Number(item.id) !== Number(own))

			if (!hasSubclients && canCreateOrg) {
				setOrgMode('new')
			}
		} catch (err) {
			console.error('Не удалось загрузить список организаций:', err)
		} finally {
			setClientsLoaded(true)
		}
	}

	const fetchCities = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/portal/cities`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) return

			const data = await res.json()

			setCities(Array.isArray(data.items) ? data.items : [])
		} catch (err) {
			console.error('Не удалось загрузить список городов:', err)
		}
	}

	const fetchSettings = async clientId => {
		setSettingsLoading(true)

		try {
			const params = new URLSearchParams()

			if (clientId) params.set('client_id', String(clientId))

			const query = params.toString()

			const res = await fetch(
				`${API_BASE_URL}/portal/installation-settings${query ? `?${query}` : ''}`,
				{ headers: getAuthHeaders() },
			)

			if (!res.ok) {
				throw new Error(
					await readError(res, 'Не удалось загрузить параметры установки'),
				)
			}

			setSettings(await res.json())
		} catch (err) {
			showError(err.message)
			setSettings(null)
		} finally {
			setSettingsLoading(false)
		}
	}

	// Организация меняется — вместе с ней меняется и предлагаемый контакт,
	// но только пока клиент не вписал свой.
	useEffect(() => {
		if (!settings || contactTouched) return

		setContactName(settings.default_contact_name || '')
		setContactPhone(settings.default_contact_phone || '')
	}, [settings, contactTouched])

	const contract = settings?.settings || null
	const isConfigured = Boolean(settings?.is_configured)
	const visitType = contract?.visit_type || null
	const needsAddress = visitType === 'ON_SITE'
	const needsCompanyFields = COMPANY_TYPES.includes(newClient.type)

	// Отсутствие флага читаем как «обязателен» — ровно так же, как это
	// делает сервер: молчание настроек значит «как у всех», а не «можно
	// без VIN».
	const vinRequired = contract?.vin_required !== false

	// Выбирает ли клиент время работ. У части клиентов (банки) время
	// определяет договор, и его подставляет сервер ближайшим рабочим
	// слотом — тогда полей даты и времени в форме нет вовсе.
	const scheduleTimeRequired = contract?.schedule_time_required !== false

	// Согласование нерабочего времени существует только там, где время
	// выбирают руками. Автослот всегда попадает в рабочее окно.
	const needsApprovalReason =
		scheduleTimeRequired && !isWorkingScheduleTime(dateValue, timeValue)

	// Ближайшее время, которое примет сервер. Пересчитывается при смене
	// договора и раз в минуту по часам.
	const earliestSlot = useMemo(
		() => computeEarliestSlot(visitType, contract?.visit_price_code),
		[visitType, contract?.visit_price_code, clockTick],
	)

	const selectedTimeMinutes = timeToMinutes(timeValue)

	const isTimeOptionDisabled = option => {
		if (!dateValue) return false
		if (dateValue > earliestSlot.date) return false
		if (dateValue < earliestSlot.date) return true

		return (timeToMinutes(option) ?? 0) < earliestSlot.minutes
	}

	// Выбор мог стать недоступным: сменился тип выезда, прошло время,
	// клиент вернулся к форме через час. Молча оставлять неверное
	// значение нельзя — сервер откажет уже после нажатия кнопки.
	useEffect(() => {
		if (!scheduleTimeRequired) return

		if (dateValue && dateValue < earliestSlot.date) {
			setDateValue('')
			setTimeValue('')
			return
		}

		if (
			dateValue === earliestSlot.date &&
			selectedTimeMinutes !== null &&
			selectedTimeMinutes < earliestSlot.minutes
		) {
			setTimeValue('')
		}
	}, [
		scheduleTimeRequired,
		dateValue,
		selectedTimeMinutes,
		earliestSlot.date,
		earliestSlot.minutes,
	])

	const chosenVehicleIds = rows
		.filter(row => row.mode === 'existing' && row.vehicle)
		.map(row => Number(row.vehicle.id))

	const updateRow = (key, patch) => {
		setRows(prev =>
			prev.map(row => (row.key === key ? { ...row, ...patch } : row)),
		)
	}

	const removeRow = key => {
		setRows(prev =>
			prev.length <= 1 ? prev : prev.filter(row => row.key !== key),
		)
	}

	const updateNewClient = patch => {
		setNewClient(prev => ({ ...prev, ...patch }))
	}

	const validateOrganization = () => {
		if (!hasOrgSection || createdClient) return null

		if (orgMode === 'existing') {
			if (!selectedClientId) {
				return invalid(
					'Выберите организацию из вашей структуры',
					'org',
					'org.client',
				)
			}

			return null
		}

		if (!newClient.name.trim()) {
			return invalid(
				'Организация: укажите ФИО контактного лица',
				'org',
				'org.name',
			)
		}

		if (!newClient.phone.trim()) {
			return invalid(
				'Организация: укажите контактный телефон',
				'org',
				'org.phone',
			)
		}

		if (needsCompanyFields && !newClient.company_name.trim()) {
			return invalid(
				'Организация: укажите наименование для ТОО или ИП',
				'org',
				'org.company_name',
			)
		}

		if (needsCompanyFields && !newClient.bin_iin.trim()) {
			return invalid(
				'Организация: для ТОО и ИП обязателен БИН/ИИН',
				'org',
				'org.bin_iin',
			)
		}

		return null
	}

	// Валидация возвращает не только текст, но и секцию, к которой нужно
	// прокрутить форму. Иначе на длинной форме сообщение вверху не говорит,
	// где именно искать незаполненное поле.
	const invalid = (message, anchor, field = null) => ({
		message,
		anchor,
		field,
	})

	const validate = () => {
		const orgError = validateOrganization()

		if (orgError) return orgError

		if (!isConfigured) {
			return invalid(
				settings?.not_configured_message ||
					'Параметры установки не согласованы. Обратитесь к вашему менеджеру.',
				'top',
			)
		}

		if (scheduleTimeRequired && !dateValue) {
			return invalid('Укажите дату работ', 'schedule', 'schedule.date')
		}

		if (scheduleTimeRequired && !timeValue) {
			return invalid('Укажите время работ', 'schedule', 'schedule.time')
		}

		if (
			scheduleTimeRequired &&
			dateValue &&
			selectedTimeMinutes !== null &&
			(dateValue < earliestSlot.date ||
				(dateValue === earliestSlot.date &&
					selectedTimeMinutes < earliestSlot.minutes))
		) {
			return invalid(
				'Это время уже недоступно. Ближайшее возможное: ' +
					`${formatDateForHuman(earliestSlot.date)} ${earliestSlot.time}.`,
				'schedule',
				'schedule.time',
			)
		}

		if (!city) return invalid('Выберите город', 'schedule', 'schedule.city')

		if (needsAddress && !address.trim()) {
			return invalid(
				'По вашему договору работы выполняются с выездом. Укажите адрес.',
				'schedule',
				'schedule.address',
			)
		}

		if (needsApprovalReason && !approvalReason.trim()) {
			return invalid(
				'Выбранное время нерабочее. Укажите причину — её увидит ваш менеджер.',
				'schedule',
				'schedule.reason',
			)
		}

		if (!contactName.trim()) {
			return invalid(
				'Укажите, кто встретит монтажника',
				'contact',
				'contact.name',
			)
		}

		if (!contactPhone.trim()) {
			return invalid(
				'Укажите телефон контактного лица',
				'contact',
				'contact.phone',
			)
		}

		if (rows.length === 0) {
			return invalid('Добавьте хотя бы одно ТС', 'vehicles')
		}

		if (rows.length > MAX_VEHICLES) {
			return invalid(
				`За одну заявку можно оформить не больше ${MAX_VEHICLES} ТС`,
				'vehicles',
			)
		}

		const seenVins = new Set()

		for (let index = 0; index < rows.length; index += 1) {
			const row = rows[index]
			const number = index + 1

			if (row.mode === 'existing') {
				if (!row.vehicle) {
					return invalid(
						`ТС ${number}: выберите машину из списка`,
						'vehicles',
						vehicleFieldName(row, 'picker'),
					)
				}

				continue
			}

			const vin = row.vin.trim().toUpperCase()

			if (!vin && vinRequired) {
				return invalid(
					`ТС ${number}: укажите VIN`,
					'vehicles',
					vehicleFieldName(row, 'vin'),
				)
			}

			// Пустой VIN — это ещё не значение, повторов среди пустых не бывает.
			// Проверяем на дубль только то, что действительно вписали.
			if (vin) {
				if (seenVins.has(vin)) {
					return invalid(
						`ТС ${number}: VIN ${vin} уже указан у другого автомобиля заявки`,
						'vehicles',
						vehicleFieldName(row, 'vin'),
					)
				}

				seenVins.add(vin)
			}

			if (!row.brand.trim()) {
				return invalid(
					`ТС ${number}: укажите марку`,
					'vehicles',
					vehicleFieldName(row, 'brand'),
				)
			}

			if (!row.model.trim()) {
				return invalid(
					`ТС ${number}: укажите модель`,
					'vehicles',
					vehicleFieldName(row, 'model'),
				)
			}

			if (row.year && (Number(row.year) < 1900 || Number(row.year) > 2100)) {
				return invalid(
					`ТС ${number}: некорректный год выпуска`,
					'vehicles',
					vehicleFieldName(row, 'year'),
				)
			}
		}

		return invalid('', null, null)
	}

	const createSubclient = async () => {
		const payload = {
			type: newClient.type,
			name: newClient.name.trim(),
			company_name: needsCompanyFields ? newClient.company_name.trim() : null,
			phone: newClient.phone.trim(),
			email: newClient.email.trim() || null,
			bin_iin: needsCompanyFields ? newClient.bin_iin.trim() : null,
		}

		const res = await fetch(`${API_BASE_URL}/portal/subclients`, {
			method: 'POST',
			headers: getJsonAuthHeaders(),
			body: JSON.stringify(payload),
		})

		if (!res.ok) {
			throw new Error(await readError(res, 'Не удалось создать организацию'))
		}

		return res.json()
	}

	const handleSubmit = async e => {
		e.preventDefault()

		const validationError = validate()

		if (validationError.message) {
			showError(
				validationError.message,
				validationError.anchor,
				validationError.field,
			)

			return
		}

		setSubmitting(true)
		setError('')

		try {
			let clientIdForRequest = targetClientId

			if (hasOrgSection && orgMode === 'new' && !createdClient) {
				const created = await createSubclient()

				setCreatedClient(created)
				clientIdForRequest = created.id

				// Список нужен обновлённым: если заявка не пройдёт,
				// организацию можно будет выбрать как существующую.
				fetchClients()
			}

			const payload = {
				client_id: clientIdForRequest,
				// Пустое время сервер поймёт правильно: у этого клиента
				// он подставит ближайший рабочий слот сам.
				scheduled_at: scheduleTimeRequired
					? buildScheduledAt(dateValue, timeValue)
					: null,
				city,
				address: needsAddress ? address.trim() : null,
				contact_name: contactName.trim(),
				contact_phone: contactPhone.trim(),
				comment: comment.trim() || null,
				schedule_approval_reason: needsApprovalReason
					? approvalReason.trim()
					: null,
				vehicles: rows.map(row =>
					row.mode === 'existing'
						? { vehicle_id: Number(row.vehicle.id) }
						: {
								vin: row.vin.trim(),
								brand: row.brand.trim(),
								model: row.model.trim(),
								plate_number: row.plate_number.trim() || null,
								year: row.year ? Number(row.year) : null,
								type: row.type.trim() || null,
							},
				),
			}

			const res = await fetch(`${API_BASE_URL}/portal/requests`, {
				method: 'POST',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify(payload),
			})

			if (!res.ok) {
				throw new Error(await readError(res, 'Не удалось создать заявку'))
			}

			onCreated(await res.json())
		} catch (err) {
			showError(err.message)
		} finally {
			setSubmitting(false)
		}
	}

	const organizationTitle = createdClient
		? `Организация: ${createdClient.name}`
		: 'Организация'

	return (
		// Клик по затемнению окно не закрывает: в форме много введённого
		// вручную, и промах мимо неё не должен стоить всей заявки.
		// Закрыть можно крестиком и кнопкой «Отмена».
		<div className='pm-overlay'>
			<div className='pm-window'>
				<div className='pm-header'>
					<div>
						<div className='pm-header-title'>Новая заявка на установку</div>
						<div className='pm-header-subtitle'>
							Оборудование и условия работ берутся из вашего договора
						</div>
					</div>

					<button className='pm-close' type='button' onClick={onClose}>
						&times;
					</button>
				</div>

				<form onSubmit={handleSubmit} style={{ display: 'contents' }}>
					<div
						className='pm-body'
						ref={bodyRef}
						onInput={handleFieldInput}
						onChange={handleFieldInput}
					>
						{error && (
							<div className='pm-banner error pm-sticky'>
								<span className='pm-banner-text'>{error}</span>

								<button
									type='button'
									className='pm-banner-close'
									title='Скрыть'
									onClick={() => {
										setError('')
										setErrorField(null)
									}}
								>
									&times;
								</button>
							</div>
						)}

						{createdClient && (
							<div className='pm-banner success'>
								Организация «{createdClient.name}» добавлена в вашу структуру.
								Заявка будет оформлена на неё.
							</div>
						)}

						{/* ---------- Организация ---------- */}

						{hasOrgSection && !createdClient && (
							<div className='pm-section' ref={orgSectionRef}>
								<div className='pm-section-head'>
									<span className='pm-section-mark' />
									<span className='pm-section-title'>{organizationTitle}</span>
								</div>

								<div className='pm-section-body'>
									{canCreateOrg && (
										<div className='pm-tabs'>
											<button
												type='button'
												className={`pm-tab ${orgMode === 'existing' ? 'active' : ''}`}
												onClick={() => setOrgMode('existing')}
											>
												Существующая
											</button>

											<button
												type='button'
												className={`pm-tab ${orgMode === 'new' ? 'active' : ''}`}
												onClick={() => setOrgMode('new')}
											>
												Новая организация
											</button>
										</div>
									)}

									{orgMode === 'existing' ? (
										<>
											<div className='pm-field'>
												<label className='pm-label'>
													Организация из вашей структуры
													<span className='req'>*</span>
												</label>

												<select
													className={fieldClass('pm-select', 'org.client')}
													value={selectedClientId}
													onChange={e => {
														setSelectedClientId(e.target.value)
														clearFieldError('org.client')
													}}
												>
													<option value=''>Выберите организацию</option>

													{subclients.map(item => (
														<option key={item.id} value={item.id}>
															{item.name}
														</option>
													))}
												</select>
											</div>

											{clientsLoaded && subclients.length === 0 && (
												<div className='pm-banner info'>
													{canCreateOrg
														? 'В вашей структуре пока нет организаций. Добавьте новую на соседней вкладке.'
														: 'В вашей структуре пока нет организаций. Обратитесь к вашему менеджеру.'}
												</div>
											)}

											<div className='pm-hint'>
												Заявка оформляется на организацию вашей структуры — ту,
												чьи машины обслуживаем.
											</div>
										</>
									) : (
										<>
											<div className='pm-field'>
												<label className='pm-label'>
													Тип лица<span className='req'>*</span>
												</label>

												<select
													className='pm-select'
													value={newClient.type}
													onChange={e =>
														updateNewClient({ type: e.target.value })
													}
												>
													{CLIENT_TYPES.map(item => (
														<option key={item.value} value={item.value}>
															{item.label}
														</option>
													))}
												</select>
											</div>

											{needsCompanyFields && (
												<div className='pm-grid pm-field'>
													<div className='pm-col'>
														<label className='pm-label'>
															Наименование<span className='req'>*</span>
														</label>

														<input
															className={fieldClass(
																'pm-input',
																'org.company_name',
															)}
															value={newClient.company_name}
															onChange={e => {
																updateNewClient({
																	company_name: e.target.value,
																})
																clearFieldError('org.company_name')
															}}
															placeholder='ТОО «Пример»'
														/>
													</div>

													<div className='pm-col'>
														<label className='pm-label'>
															БИН / ИИН<span className='req'>*</span>
														</label>

														<input
															className={fieldClass('pm-input', 'org.bin_iin')}
															value={newClient.bin_iin}
															onChange={e => {
																updateNewClient({
																	bin_iin: e.target.value.replace(/\D/g, ''),
																})
																clearFieldError('org.bin_iin')
															}}
															placeholder='12 цифр'
														/>
													</div>
												</div>
											)}

											<div className='pm-grid pm-field'>
												<div className='pm-col'>
													<label className='pm-label'>
														ФИО контактного лица<span className='req'>*</span>
													</label>

													<input
														className={fieldClass('pm-input', 'org.name')}
														value={newClient.name}
														onChange={e => {
															updateNewClient({ name: e.target.value })
															clearFieldError('org.name')
														}}
													/>
												</div>

												<div className='pm-col'>
													<label className='pm-label'>
														Телефон<span className='req'>*</span>
													</label>

													<input
														className={fieldClass('pm-input', 'org.phone')}
														value={newClient.phone}
														onChange={e => {
															updateNewClient({ phone: e.target.value })
															clearFieldError('org.phone')
														}}
														placeholder='+7 ___ ___ __ __'
													/>
												</div>
											</div>

											<div className='pm-field'>
												<label className='pm-label'>Email</label>

												<input
													className='pm-input'
													value={newClient.email}
													onChange={e =>
														updateNewClient({ email: e.target.value })
													}
												/>
											</div>

											<div className='pm-hint'>
												Организация появится в вашей структуре, а условия оплаты
												и ответственный менеджер перейдут от вашей организации.
												Она создаётся в момент отправки заявки.
											</div>
										</>
									)}
								</div>
							</div>
						)}

						{/* ---------- Договор ---------- */}

						{settingsLoading ? (
							<div className='pm-banner info'>
								Загрузка параметров договора...
							</div>
						) : !settingsReady ? (
							<div className='pm-banner info'>
								Выберите организацию — покажем, что будет установлено по
								договору.
							</div>
						) : !isConfigured ? (
							<div className='pm-banner warn'>
								{settings?.not_configured_message ||
									'Параметры установки не согласованы. Обратитесь к вашему менеджеру.'}
							</div>
						) : (
							<div className='pm-section info'>
								<div className='pm-section-head'>
									<span className='pm-section-mark' />
									<span className='pm-section-title'>
										Что будет установлено по договору
									</span>
								</div>

								<div className='pm-section-body'>
									<div className='pm-row'>
										<span className='pm-row-key'>Платформа</span>
										<span className='pm-row-val'>
											{contract.platform || '—'}
										</span>
									</div>

									<div className='pm-row'>
										<span className='pm-row-key'>Формат работ</span>
										<span className='pm-row-val'>
											{VISIT_TYPE_LABELS[visitType] || visitType || '—'}
											{visitType === 'ON_SITE' &&
											VISIT_PRICE_LABELS[contract.visit_price_code]
												? ` · ${VISIT_PRICE_LABELS[contract.visit_price_code]}`
												: ''}
										</span>
									</div>

									<div className='pm-row'>
										<span className='pm-row-key'>GPS-трекер</span>
										<span className='pm-row-val'>
											{contract.gps_price_code
												? contract.gps_price_name || contract.gps_price_code
												: 'не устанавливается'}
										</span>
									</div>

									{contract.gps_price_code &&
										contract.tracker_subscription_months > 0 && (
											<div className='pm-row'>
												<span className='pm-row-key'>Подписка трекера</span>
												<span className='pm-row-val'>
													{contract.tracker_subscription_months} мес.
												</span>
											</div>
										)}

									{contract.gps_price_code && (
										<div className='pm-row'>
											<span className='pm-row-key'>Блокировка двигателя</span>
											<span className='pm-row-val'>
												{contract.has_blocking ? 'да' : 'нет'}
											</span>
										</div>
									)}

									<div className='pm-row'>
										<span className='pm-row-key'>Маяк</span>
										<span className='pm-row-val'>
											{contract.has_beacon
												? contract.beacon_subscription_months > 0
													? `да · подписка ${contract.beacon_subscription_months} мес.`
													: 'да'
												: 'нет'}
										</span>
									</div>

									{(settings.sensors || []).length > 0 && (
										<div className='pm-row'>
											<span className='pm-row-key'>Дополнительные датчики</span>
											<span className='pm-row-val'>
												{settings.sensors
													.map(sensor =>
														canSeePrices && sensor.price !== null
															? `${sensor.name} — ${formatMoney(sensor.price)}`
															: sensor.name,
													)
													.join(', ')}
											</span>
										</div>
									)}

									<div className='pm-hint'>
										Параметры согласованы с вашим менеджером и применяются ко
										всем ТС заявки одинаково. Чтобы изменить — свяжитесь с
										менеджером.
									</div>
								</div>
							</div>
						)}

						{/* ---------- Когда и где ---------- */}

						<div className='pm-section' ref={scheduleSectionRef}>
							<div className='pm-section-head'>
								<span className='pm-section-mark' />
								<span className='pm-section-title'>
									{scheduleTimeRequired ? 'Когда и где' : 'Где'}
								</span>
							</div>

							<div className='pm-section-body'>
								{scheduleTimeRequired ? (
									<>
										<div className='pm-grid pm-field'>
											<div className='pm-col'>
												<label className='pm-label'>
													Дата<span className='req'>*</span>
												</label>

												<input
													type='date'
													className={fieldClass('pm-input', 'schedule.date')}
													value={dateValue}
													min={earliestSlot.date}
													onChange={e => setDateValue(e.target.value)}
												/>
											</div>

											<div className='pm-col'>
												<label className='pm-label'>
													Время<span className='req'>*</span>
												</label>

												<select
													className={fieldClass('pm-select', 'schedule.time')}
													value={timeValue}
													onChange={e => setTimeValue(e.target.value)}
												>
													<option value=''>Выберите время</option>

													{TIME_OPTIONS.map(option => (
														<option
															key={option}
															value={option}
															disabled={isTimeOptionDisabled(option)}
														>
															{option}
														</option>
													))}
												</select>
											</div>
										</div>

										<div className='pm-hint'>
											Ближайшее доступное время:{' '}
											{formatDateForHuman(earliestSlot.date)}{' '}
											{earliestSlot.time}
											{visitType === 'ON_SITE'
												? ' — с учётом времени на дорогу по вашему договору.'
												: '.'}
										</div>

										{needsApprovalReason && (
											<div className='pm-field'>
												<div className='pm-banner warn'>
													Выбранное время вне рабочих часов (пн–пт,
													10:00–17:30). Заявку подтвердит руководитель — укажите
													причину.
												</div>

												<label className='pm-label'>
													Причина<span className='req'>*</span>
												</label>

												<input
													className={fieldClass('pm-input', 'schedule.reason')}
													value={approvalReason}
													onChange={e => setApprovalReason(e.target.value)}
													placeholder='Например: машины доступны только в выходной'
												/>
											</div>
										)}
									</>
								) : (
									<div className='pm-banner info'>
										Время работ по вашему договору назначаем мы. Заявка встанет
										на ближайшее рабочее время с учётом дороги — пн–пт,
										10:00–17:30. Точное время вы увидите в списке заявок сразу
										после создания.
									</div>
								)}

								<div className='pm-field'>
									<label className='pm-label'>
										Город<span className='req'>*</span>
									</label>

									<select
										className={fieldClass('pm-select', 'schedule.city')}
										value={city}
										onChange={e => setCity(e.target.value)}
									>
										<option value=''>Выберите город</option>

										{cities.map(item => (
											<option key={item} value={item}>
												{item}
											</option>
										))}
									</select>
								</div>

								{needsAddress && (
									<div className='pm-field'>
										<label className='pm-label'>
											Адрес выезда<span className='req'>*</span>
										</label>

										<input
											className={fieldClass('pm-input', 'schedule.address')}
											value={address}
											onChange={e => setAddress(e.target.value)}
											placeholder='Улица, дом, ориентир'
										/>
									</div>
								)}

								{visitType === 'IN_OFFICE' && (
									<div className='pm-hint'>
										По договору работы выполняются в офисе — адрес не нужен.
									</div>
								)}
							</div>
						</div>

						{/* ---------- Контактное лицо ---------- */}

						<div className='pm-section' ref={contactSectionRef}>
							<div className='pm-section-head'>
								<span className='pm-section-mark' />
								<span className='pm-section-title'>Контактное лицо</span>
							</div>

							<div className='pm-section-body'>
								<div className='pm-hint'>
									Кого встретит монтажник и по какому номеру с ним связаться.
									Можно указать водителя или ответственного на месте — данные
									вашей организации при этом не меняются.
								</div>

								<div className='pm-grid pm-field'>
									<div className='pm-col'>
										<label className='pm-label'>
											ФИО<span className='req'>*</span>
										</label>

										<input
											className={fieldClass('pm-input', 'contact.name')}
											value={contactName}
											onChange={e => {
												setContactTouched(true)
												setContactName(e.target.value)
											}}
											placeholder='Кто встречает на месте'
										/>
									</div>

									<div className='pm-col'>
										<label className='pm-label'>
											Телефон<span className='req'>*</span>
										</label>

										<input
											className={fieldClass('pm-input', 'contact.phone')}
											value={contactPhone}
											onChange={e => {
												setContactTouched(true)
												setContactPhone(e.target.value)
											}}
											placeholder='+7 ___ ___ __ __'
										/>
									</div>
								</div>
							</div>
						</div>

						{/* ---------- Автомобили ---------- */}

						<div className='pm-section' ref={vehiclesSectionRef}>
							<div className='pm-section-head'>
								<span className='pm-section-mark' />
								<span className='pm-section-title'>Автомобили</span>
								<span className='pm-section-count'>{rows.length} шт.</span>
							</div>

							<div className='pm-section-body'>
								{!vinRequired && (
									<div className='pm-banner info'>
										По вашему договору VIN можно указать позже. Заявка примется
										без него, но завершить работы и привязать оборудование без
										VIN нельзя — монтажник впишет его на месте.
									</div>
								)}

								{rows.map((row, index) => (
									<div
										key={row.key}
										className={`pm-card ${
											vehicleHasError(row) ? 'pm-card-invalid' : ''
										}`}
									>
										<div className='pm-card-head'>
											<span className='pm-card-title'>ТС {index + 1}</span>

											{rows.length > 1 && (
												<button
													type='button'
													className='pm-link danger'
													onClick={() => removeRow(row.key)}
												>
													Убрать
												</button>
											)}
										</div>

										{allowExistingVehicles && (
											<div className='pm-tabs'>
												<button
													type='button'
													className={`pm-tab ${row.mode === 'new' ? 'active' : ''}`}
													onClick={() =>
														updateRow(row.key, { mode: 'new', vehicle: null })
													}
												>
													Новое ТС
												</button>

												<button
													type='button'
													className={`pm-tab ${row.mode === 'existing' ? 'active' : ''}`}
													onClick={() =>
														updateRow(row.key, { mode: 'existing' })
													}
												>
													Из существующих ТС
												</button>
											</div>
										)}

										{row.mode === 'existing' ? (
											<VehiclePicker
												clientId={vehiclesClientId}
												excludeIds={chosenVehicleIds.filter(
													id => id !== Number(row.vehicle?.id),
												)}
												value={row.vehicle}
												onChange={vehicle => updateRow(row.key, { vehicle })}
											/>
										) : (
											<>
												<div className='pm-field'>
													<label className='pm-label'>
														VIN
														{vinRequired && <span className='req'>*</span>}
													</label>

													<input
														className={fieldClass(
															'pm-input',
															vehicleFieldName(row, 'vin'),
														)}
														value={row.vin}
														onChange={e =>
															updateRow(row.key, {
																vin: e.target.value.toUpperCase(),
															})
														}
														placeholder={
															vinRequired
																? '17 символов'
																: '17 символов — можно оставить пустым'
														}
													/>

													{!vinRequired && (
														<div className='pm-hint'>
															Если VIN пока неизвестен, оставьте поле пустым —
															монтажник впишет его на месте.
														</div>
													)}
												</div>

												<div className='pm-grid pm-field'>
													<div className='pm-col'>
														<label className='pm-label'>
															Марка<span className='req'>*</span>
														</label>

														<input
															className={fieldClass(
																'pm-input',
																vehicleFieldName(row, 'brand'),
															)}
															value={row.brand}
															onChange={e =>
																updateRow(row.key, { brand: e.target.value })
															}
														/>
													</div>

													<div className='pm-col'>
														<label className='pm-label'>
															Модель<span className='req'>*</span>
														</label>

														<input
															className={fieldClass(
																'pm-input',
																vehicleFieldName(row, 'model'),
															)}
															value={row.model}
															onChange={e =>
																updateRow(row.key, { model: e.target.value })
															}
														/>
													</div>
												</div>

												<div className='pm-grid'>
													<div className='pm-col'>
														<label className='pm-label'>Госномер</label>

														<input
															className='pm-input'
															value={row.plate_number}
															onChange={e =>
																updateRow(row.key, {
																	plate_number: e.target.value.toUpperCase(),
																})
															}
														/>
													</div>

													<div className='pm-col'>
														<label className='pm-label'>Год выпуска</label>

														<input
															className={fieldClass(
																'pm-input',
																vehicleFieldName(row, 'year'),
															)}
															value={row.year}
															onChange={e =>
																updateRow(row.key, {
																	year: e.target.value.replace(/\D/g, ''),
																})
															}
															placeholder='2021'
														/>
													</div>

													<div className='pm-col'>
														<label className='pm-label'>Тип</label>

														<input
															className='pm-input'
															value={row.type}
															onChange={e =>
																updateRow(row.key, { type: e.target.value })
															}
															placeholder='Легковая'
														/>
													</div>
												</div>
											</>
										)}
									</div>
								))}

								<button
									type='button'
									className='pm-btn wide'
									disabled={rows.length >= MAX_VEHICLES}
									onClick={() => setRows(prev => [...prev, createEmptyRow()])}
								>
									+ Добавить ТС
								</button>

								<div className='pm-hint'>
									{allowExistingVehicles
										? 'Если заявка по уже обслуженному ранее авто — выберите его из списка существующих.'
										: 'У новой организации машин в системе ещё нет, поэтому все ТС добавляются как новые.'}
								</div>
							</div>
						</div>

						{/* ---------- Комментарий ---------- */}

						<div className='pm-section'>
							<div className='pm-section-head'>
								<span className='pm-section-mark' />
								<span className='pm-section-title'>Комментарий менеджеру</span>
							</div>

							<div className='pm-section-body'>
								<textarea
									className='pm-textarea'
									value={comment}
									onChange={e => setComment(e.target.value)}
									placeholder='Что важно знать по этой заявке...'
								/>

								<div className='pm-hint'>
									Необязательно. Комментарий появится в переписке по заявке.
								</div>
							</div>
						</div>
					</div>

					<div className='pm-footer'>
						<button
							type='button'
							className='pm-btn'
							onClick={onClose}
							disabled={submitting}
						>
							Отмена
						</button>

						<button
							type='submit'
							className='pm-btn primary'
							disabled={submitting || settingsLoading || !isConfigured}
						>
							{submitting ? 'Создание...' : 'Создать заявку'}
						</button>
					</div>
				</form>
			</div>
		</div>
	)
}
