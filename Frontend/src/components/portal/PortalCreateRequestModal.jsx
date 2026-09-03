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

const getTodayString = () => {
	const now = new Date()

	const year = now.getFullYear()
	const month = String(now.getMonth() + 1).padStart(2, '0')
	const day = String(now.getDate()).padStart(2, '0')

	return `${year}-${month}-${day}`
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

	const [rows, setRows] = useState([createEmptyRow()])

	const [error, setError] = useState('')
	const [submitting, setSubmitting] = useState(false)

	const today = useMemo(getTodayString, [])

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
		return data?.detail || fallback
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
			setError(err.message)
			setSettings(null)
		} finally {
			setSettingsLoading(false)
		}
	}

	const contract = settings?.settings || null
	const isConfigured = Boolean(settings?.is_configured)
	const visitType = contract?.visit_type || null
	const needsAddress = visitType === 'ON_SITE'
	const needsApprovalReason = !isWorkingScheduleTime(dateValue, timeValue)
	const needsCompanyFields = COMPANY_TYPES.includes(newClient.type)

	// Отсутствие флага читаем как «обязателен» — ровно так же, как это
	// делает сервер: молчание настроек значит «как у всех», а не «можно
	// без VIN».
	const vinRequired = contract?.vin_required !== false

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
		if (!hasOrgSection || createdClient) return ''

		if (orgMode === 'existing') {
			if (!selectedClientId) return 'Выберите организацию из вашей структуры'
			return ''
		}

		if (!newClient.name.trim())
			return 'Организация: укажите ФИО контактного лица'
		if (!newClient.phone.trim())
			return 'Организация: укажите контактный телефон'

		if (needsCompanyFields && !newClient.company_name.trim()) {
			return 'Организация: укажите наименование для ТОО или ИП'
		}

		if (needsCompanyFields && !newClient.bin_iin.trim()) {
			return 'Организация: для ТОО и ИП обязателен БИН/ИИН'
		}

		return ''
	}

	const validate = () => {
		const orgError = validateOrganization()

		if (orgError) return orgError

		if (!isConfigured) {
			return (
				settings?.not_configured_message ||
				'Параметры установки не согласованы. Обратитесь к вашему менеджеру.'
			)
		}

		if (!dateValue || !timeValue) return 'Укажите дату и время работ'
		if (!city) return 'Выберите город'

		if (needsAddress && !address.trim()) {
			return 'По вашему договору работы выполняются с выездом. Укажите адрес.'
		}

		if (needsApprovalReason && !approvalReason.trim()) {
			return 'Выбранное время нерабочее. Укажите причину — её увидит ваш менеджер.'
		}

		if (rows.length === 0) return 'Добавьте хотя бы одно ТС'

		if (rows.length > MAX_VEHICLES) {
			return `За одну заявку можно оформить не больше ${MAX_VEHICLES} ТС`
		}

		const seenVins = new Set()

		for (let index = 0; index < rows.length; index += 1) {
			const row = rows[index]
			const number = index + 1

			if (row.mode === 'existing') {
				if (!row.vehicle) return `ТС ${number}: выберите машину из списка`
				continue
			}

			const vin = row.vin.trim().toUpperCase()

			if (!vin && vinRequired) return `ТС ${number}: укажите VIN`

			// Пустой VIN — это ещё не значение, повторов среди пустых не бывает.
			// Проверяем на дубль только то, что действительно вписали.
			if (vin) {
				if (seenVins.has(vin)) return `VIN ${vin} указан дважды`

				seenVins.add(vin)
			}

			if (!row.brand.trim() || !row.model.trim()) {
				return `ТС ${number}: укажите марку и модель`
			}

			if (row.year && (Number(row.year) < 1900 || Number(row.year) > 2100)) {
				return `ТС ${number}: некорректный год выпуска`
			}
		}

		return ''
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

		if (validationError) {
			setError(validationError)
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
				scheduled_at: buildScheduledAt(dateValue, timeValue),
				city,
				address: needsAddress ? address.trim() : null,
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
			setError(err.message)
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
					<div className='pm-body'>
						{error && <div className='pm-banner error'>{error}</div>}

						{createdClient && (
							<div className='pm-banner success'>
								Организация «{createdClient.name}» добавлена в вашу структуру.
								Заявка будет оформлена на неё.
							</div>
						)}

						{/* ---------- Организация ---------- */}

						{hasOrgSection && !createdClient && (
							<div className='pm-section'>
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
													className='pm-select'
													value={selectedClientId}
													onChange={e => setSelectedClientId(e.target.value)}
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
															className='pm-input'
															value={newClient.company_name}
															onChange={e =>
																updateNewClient({
																	company_name: e.target.value,
																})
															}
															placeholder='ТОО «Пример»'
														/>
													</div>

													<div className='pm-col'>
														<label className='pm-label'>
															БИН / ИИН<span className='req'>*</span>
														</label>

														<input
															className='pm-input'
															value={newClient.bin_iin}
															onChange={e =>
																updateNewClient({
																	bin_iin: e.target.value.replace(/\D/g, ''),
																})
															}
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
														className='pm-input'
														value={newClient.name}
														onChange={e =>
															updateNewClient({ name: e.target.value })
														}
													/>
												</div>

												<div className='pm-col'>
													<label className='pm-label'>
														Телефон<span className='req'>*</span>
													</label>

													<input
														className='pm-input'
														value={newClient.phone}
														onChange={e =>
															updateNewClient({ phone: e.target.value })
														}
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

						<div className='pm-section'>
							<div className='pm-section-head'>
								<span className='pm-section-mark' />
								<span className='pm-section-title'>Когда и где</span>
							</div>

							<div className='pm-section-body'>
								<div className='pm-grid pm-field'>
									<div className='pm-col'>
										<label className='pm-label'>
											Дата<span className='req'>*</span>
										</label>

										<input
											type='date'
											className='pm-input'
											value={dateValue}
											min={today}
											onChange={e => setDateValue(e.target.value)}
										/>
									</div>

									<div className='pm-col'>
										<label className='pm-label'>
											Время<span className='req'>*</span>
										</label>

										<select
											className='pm-select'
											value={timeValue}
											onChange={e => setTimeValue(e.target.value)}
										>
											<option value=''>Выберите время</option>

											{TIME_OPTIONS.map(option => (
												<option key={option} value={option}>
													{option}
												</option>
											))}
										</select>
									</div>
								</div>

								{needsApprovalReason && (
									<div className='pm-field'>
										<div className='pm-banner warn'>
											Выбранное время вне рабочих часов (пн–пт, 10:00–17:30).
											Заявку подтвердит руководитель — укажите причину.
										</div>

										<label className='pm-label'>
											Причина<span className='req'>*</span>
										</label>

										<input
											className='pm-input'
											value={approvalReason}
											onChange={e => setApprovalReason(e.target.value)}
											placeholder='Например: машины доступны только в выходной'
										/>
									</div>
								)}

								<div className='pm-field'>
									<label className='pm-label'>
										Город<span className='req'>*</span>
									</label>

									<select
										className='pm-select'
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
											className='pm-input'
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

						{/* ---------- Автомобили ---------- */}

						<div className='pm-section'>
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
									<div key={row.key} className='pm-card'>
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
														className='pm-input'
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
															className='pm-input'
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
															className='pm-input'
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
															className='pm-input'
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
