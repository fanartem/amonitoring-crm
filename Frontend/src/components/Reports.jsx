import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { API_BASE_URL, getAuthHeaders } from '../api'
import '../styles/Requests.css'
import '../styles/Reports.css'

const getTokenPayload = () => {
	try {
		const token = localStorage.getItem('access_token')
		if (!token) return null
		const base64Url = token.split('.')[1]
		const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
		const jsonPayload = decodeURIComponent(
			atob(base64)
				.split('')
				.map(function (c) {
					return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
				})
				.join(''),
		)
		return JSON.parse(jsonPayload)
	} catch (error) {
		return null
	}
}

const getUserRole = () => getTokenPayload()?.role ?? null

// В разных версиях токена id пользователя лежит под разными ключами —
// перебираем известные варианты, чтобы не завязываться на один формат.
const getUserId = () => {
	const payload = getTokenPayload()
	if (!payload) return null

	const raw = payload.user_id ?? payload.id ?? payload.sub
	const parsed = Number(raw)

	return Number.isFinite(parsed) ? parsed : null
}

const toNumber = (value) => {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : 0
}

const CURRENCY_SUFFIX = '\u20B8'

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
	maximumFractionDigits: 0,
})

const formatMoney = (value) =>
	`${moneyFormatter.format(Math.round(toNumber(value)))} ${CURRENCY_SUFFIX}`

// "Свои" заявки менеджера считаем двумя способами: по ответственности за
// клиента и по авторству заявки — бэкенд отдаёт менеджеру объединение обоих.
const PERSONAL_SCOPE_OPTIONS = [
	{ value: 'all_mine', label: 'Всё' },
	{ value: 'my_clients', label: 'Клиенты' },
	{ value: 'created_by_me', label: 'Созданные' },
]

const PERSONAL_SCOPE_HINT =
	'Клиенты — где менеджер ответственный; Созданные — где менеджер автор заявки'

// Кому "принадлежит" заявка при выбранном срезе. Ровно та же логика, что
// в matchesPersonalScope, но в обратную сторону — для рейтинга менеджеров.
const getScopeOwnerIds = (req, scope) => {
	const responsible =
		req.responsible_manager_id != null
			? Number(req.responsible_manager_id)
			: null

	const creator = req.created_by != null ? Number(req.created_by) : null

	if (scope === 'my_clients') return responsible != null ? [responsible] : []
	if (scope === 'created_by_me') return creator != null ? [creator] : []

	const ids = []
	if (responsible != null) ids.push(responsible)
	if (creator != null && creator !== responsible) ids.push(creator)

	return ids
}

const ROLE_LABELS = {
	MANAGER: 'менеджер',
	ROP: 'РОП',
	ADMIN: 'админ',
}

const matchesPersonalScope = (req, scope, userId) => {
	if (userId == null) return true

	const isMyClient =
		req.responsible_manager_id != null &&
		Number(req.responsible_manager_id) === userId

	const isMyRequest =
		req.created_by != null && Number(req.created_by) === userId

	if (scope === 'my_clients') return isMyClient
	if (scope === 'created_by_me') return isMyRequest

	return isMyClient || isMyRequest
}

// Те же 4 значения, что бэкенд проверяет в requests.py (allowed_work_types).
// Цвета не завязаны на utils/workTypes.js (его не видели) — если он отличается
// по формулировкам, эти лейблы легко поправить в одном месте.
const WORK_TYPE_META = {
	INSTALLATION: { label: 'Установка', color: '#5e9424' },
	DIAGNOSTIC: { label: 'Диагностика', color: '#2f6fed' },
	REMOVAL: { label: 'Снятие', color: '#f5a623' },
	REFLASHING: { label: 'Перепрошивка', color: '#8e5cd9' },
}

// Цвета статусов взяты 1-в-1 из .status-badge в Requests.css — чтобы отчёт
// говорил на том же визуальном языке, что и сама вкладка "Заявки".
const STATUS_META = {
	NEW: { label: 'В ожидании', color: '#f57f17' },
	IN_PROGRESS: { label: 'В работе', color: '#1565c0' },
	COMPLETED: { label: 'Завершено', color: '#2e7d32' },
	CANCELLED: { label: 'Отменено', color: '#c62828' },
}

const GRANULARITY_OPTIONS = [
	{ value: 'day', label: 'По дням' },
	{ value: 'week', label: 'По неделям' },
	{ value: 'month', label: 'По месяцам' },
]

const MONTH_NAMES = [
	'янв',
	'фев',
	'мар',
	'апр',
	'май',
	'июн',
	'июл',
	'авг',
	'сен',
	'окт',
	'ноя',
	'дек',
]

const pad2 = (n) => String(n).padStart(2, '0')

// created_at — единственная надёжная дата на заявке (бэкенд не хранит
// completed_at/cancelled_at на самой строке), поэтому весь тайм-ряд строится
// по дате создания заявки, а не по дате завершения работ.
const getPeriodKey = (dateStr, granularity) => {
	const date = new Date(dateStr)
	if (Number.isNaN(date.getTime())) return null

	if (granularity === 'month') {
		return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
	}

	if (granularity === 'week') {
		const day = date.getDay() || 7
		const monday = new Date(date)
		monday.setHours(0, 0, 0, 0)
		monday.setDate(date.getDate() - day + 1)
		return `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(
			monday.getDate(),
		)}`
	}

	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
		date.getDate(),
	)}`
}

const formatPeriodLabel = (key, granularity) => {
	if (granularity === 'month') {
		const [year, month] = key.split('-')
		return `${MONTH_NAMES[Number(month) - 1]} ${year}`
	}

	const [year, month, day] = key.split('-')
	const shortLabel = `${day}.${month}`

	return granularity === 'week' ? `с ${shortLabel}` : shortLabel
}

// Диапазон "текущего" периода для сравнения с прошлым: если заданы явные
// даты фильтра — берём их, иначе — текущая календарная неделя/месяц
// (по сегодняшней дате).
const getCurrentPeriodRange = (granularity, filters) => {
	if (filters.date_from || filters.date_to) {
		const from = filters.date_from ? new Date(filters.date_from) : null
		if (from) from.setHours(0, 0, 0, 0)

		const to = filters.date_to ? new Date(filters.date_to) : new Date()
		to.setHours(23, 59, 59, 999)

		return { from, to }
	}

	const now = new Date()

	if (granularity === 'month') {
		const from = new Date(now.getFullYear(), now.getMonth(), 1)
		const to = new Date(
			now.getFullYear(),
			now.getMonth() + 1,
			0,
			23,
			59,
			59,
			999,
		)
		return { from, to }
	}

	const day = now.getDay() || 7
	const monday = new Date(now)
	monday.setHours(0, 0, 0, 0)
	monday.setDate(now.getDate() - day + 1)

	const sunday = new Date(monday)
	sunday.setDate(monday.getDate() + 6)
	sunday.setHours(23, 59, 59, 999)

	return { from: monday, to: sunday }
}

// Предыдущий период той же длины (для месяца — предыдущий календарный месяц,
// чтобы не путаться с разным числом дней в месяцах).
const getPreviousPeriodRange = ({ from, to }, granularity) => {
	if (!from) return { from: null, to: null }

	if (granularity === 'month') {
		const prevFrom = new Date(from.getFullYear(), from.getMonth() - 1, 1)
		const prevTo = new Date(
			from.getFullYear(),
			from.getMonth(),
			0,
			23,
			59,
			59,
			999,
		)
		return { from: prevFrom, to: prevTo }
	}

	const durationMs = to.getTime() - from.getTime()
	const prevTo = new Date(from.getTime() - 1)
	const prevFrom = new Date(prevTo.getTime() - durationMs)

	return { from: prevFrom, to: prevTo }
}

const getClientDisplayName = (req) => {
	const clientType = req.client_type || req.type

	if (clientType === 'TOO' || clientType === 'IP') {
		return req.company_name || req.client_name || 'Без названия'
	}

	return req.client_name || req.company_name || 'Без названия'
}

// Единый "ключ" клиента для группировки/фильтра — не у всех старых заявок
// есть client_id, поэтому подстраховываемся телефоном, а затем именем.
const getClientKey = (req) =>
	String(req.client_id ?? req.phone ?? getClientDisplayName(req))

const getRequestExecutors = (req) => {
	if (Array.isArray(req.executors) && req.executors.length > 0) {
		return req.executors.map((executor) => ({
			id: executor.user_id,
			name: executor.user_name || `ID: ${executor.user_id}`,
		}))
	}

	if (req.assigned_to) {
		return [{ id: req.assigned_to, name: `ID: ${req.assigned_to}` }]
	}

	return []
}

// Приводим Map-накопитель к массиву: сортировка по убыванию счётчика,
// при равенстве — по алфавиту, чтобы порядок не "прыгал" между рендерами.
const finalizeBreakdown = (map, color) =>
	[...map.values()]
		.sort(
			(a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru'),
		)
		.map((item) => ({
			...item,
			color,
			children: [...item.children.values()].sort(
				(a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru'),
			),
		}))

// Для каждого монтажника — общий счётчик + разбивка по клиентам
// (каким клиентам и сколько раз он выполнял работы).
const buildTechnicianStats = (list) => {
	const map = new Map()

	list.forEach((r) => {
		const clientKey = getClientKey(r)
		const clientLabel = getClientDisplayName(r)

		getRequestExecutors(r).forEach((executor) => {
			if (executor.id == null) return

			if (!map.has(executor.id)) {
				map.set(executor.id, {
					key: executor.id,
					label: executor.name,
					count: 0,
					children: new Map(),
				})
			}

			const entry = map.get(executor.id)
			entry.count += 1

			if (!entry.children.has(clientKey)) {
				entry.children.set(clientKey, {
					key: clientKey,
					label: clientLabel,
					count: 0,
				})
			}

			entry.children.get(clientKey).count += 1
		})
	})

	return finalizeBreakdown(map, '#2f6fed')
}

// Горизонтальный список с пропорциональными полосками — для разбивок
// по статусу, типу работ, топ-клиентам и топ-монтажникам.
function BarList({ items, emptyLabel = 'Нет данных за период' }) {
	if (items.length === 0) {
		return <div className='reports-empty'>{emptyLabel}</div>
	}

	const maxValue = Math.max(...items.map((item) => item.count), 1)

	return (
		<div className='reports-bar-list'>
			{items.map((item) => (
				<div key={item.key} className='reports-bar-row'>
					<div className='reports-bar-row-label' title={item.label}>
						{item.label}
					</div>
					<div className='reports-bar-row-track'>
						<div
							className='reports-bar-row-fill'
							style={{
								width: `${Math.max((item.count / maxValue) * 100, 4)}%`,
								background: item.color || '#5e9424',
							}}
						/>
					</div>
					<div className='reports-bar-row-count'>{item.count}</div>
				</div>
			))}
		</div>
	)
}

// Универсальный раскрывающийся список: клик по строке показывает разбивку
// (для монтажника — по каким клиентам работал, для клиента — какие монтажники
// у него были). Используется и в карточке, и в модальном окне "показать все".
function BreakdownList({
	items,
	emptyLabel = 'Нет данных за период',
	childFillColor = '#b9cde6',
	formatValue = (value) => value,
}) {
	const [expandedKey, setExpandedKey] = useState(null)

	if (items.length === 0) {
		return <div className='reports-empty'>{emptyLabel}</div>
	}

	const maxValue = Math.max(...items.map((item) => item.count), 1)

	return (
		<div className='reports-bar-list'>
			{items.map((item) => {
				const itemKey = String(item.key)
				const children = item.children || []
				const hasChildren = children.length > 0
				const isOpen = hasChildren && expandedKey === itemKey
				const maxChildValue = Math.max(
					...children.map((child) => child.count),
					1,
				)

				return (
					<div key={itemKey} className='reports-tech-row'>
						<button
							type='button'
							className={`reports-bar-row reports-tech-row-toggle ${
								isOpen ? 'is-open' : ''
							}`}
							onClick={() =>
								hasChildren && setExpandedKey(isOpen ? null : itemKey)
							}
							aria-expanded={isOpen}
							disabled={!hasChildren}
						>
							<span className='reports-bar-row-label' title={item.label}>
								<i className='fa-solid fa-chevron-right reports-tech-chevron'></i>
								{item.label}
							</span>

							<span className='reports-bar-row-track'>
								<span
									className='reports-bar-row-fill'
									style={{
										width: `${Math.max((item.count / maxValue) * 100, 4)}%`,
										background: item.color || '#5e9424',
									}}
								/>
							</span>

							<span className='reports-bar-row-count'>
								{formatValue(item.count)}
							</span>
						</button>

						{isOpen && (
							<div className='reports-tech-clients'>
								{children.map((child) => (
									<div key={child.key} className='reports-tech-client-row'>
										<span
											className='reports-tech-client-label'
											title={child.label}
										>
											{child.label}
										</span>

										<span className='reports-tech-client-track'>
											<span
												className='reports-tech-client-fill'
												style={{
													width: `${Math.max(
														(child.count / maxChildValue) * 100,
														4,
													)}%`,
													background: childFillColor,
												}}
											/>
										</span>

										<span className='reports-tech-client-count'>
											{formatValue(child.count)}
										</span>
									</div>
								))}
							</div>
						)}
					</div>
				)
			})}
		</div>
	)
}

// Модальное окно "показать все": полный список без обрезки до топ-8,
// с поиском по названию и по вложенным строкам.
function ReportsListModal({
	title,
	note,
	items,
	searchPlaceholder = 'Поиск...',
	emptyLabel = 'Нет данных за период',
	childFillColor = '#b9cde6',
	totalLabel = 'Всего заявок',
	formatValue = (value) => value,
	toolbarExtra = null,
	onClose,
}) {
	const [query, setQuery] = useState('')

	useEffect(() => {
		const handleKeyDown = (e) => {
			if (e.key === 'Escape') onClose()
		}

		const previousOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		document.addEventListener('keydown', handleKeyDown)

		return () => {
			document.body.style.overflow = previousOverflow
			document.removeEventListener('keydown', handleKeyDown)
		}
	}, [onClose])

	const normalizedQuery = query.trim().toLowerCase()

	const filtered = normalizedQuery
		? items.filter((item) => {
				if (String(item.label).toLowerCase().includes(normalizedQuery)) {
					return true
				}

				return (item.children || []).some((child) =>
					String(child.label).toLowerCase().includes(normalizedQuery),
				)
			})
		: items

	const totalCount = items.reduce((sum, item) => sum + item.count, 0)

	return createPortal(
		<div
			className='reports-modal-backdrop'
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose()
			}}
		>
			<div className='reports-modal' role='dialog' aria-modal='true'>
				<div className='reports-modal-header'>
					<div>
						<h3 className='reports-modal-title'>{title}</h3>
						{note && <p className='reports-modal-note'>{note}</p>}
					</div>

					<button
						type='button'
						className='reports-modal-close'
						onClick={onClose}
						aria-label='Закрыть'
					>
						<i className='fa-solid fa-xmark'></i>
					</button>
				</div>

				<div className='reports-modal-toolbar'>
					<input
						type='text'
						className='reports-modal-search'
						autoComplete='off'
						placeholder={searchPlaceholder}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>

					{toolbarExtra}
				</div>

				<div className='reports-modal-meta'>
					<span>
						Показано {filtered.length} из {items.length}
					</span>
					<span>
						{totalLabel}: {formatValue(totalCount)}
					</span>
				</div>

				<div className='reports-modal-body'>
					<BreakdownList
						items={filtered}
						emptyLabel={normalizedQuery ? 'Ничего не найдено' : emptyLabel}
						childFillColor={childFillColor}
						formatValue={formatValue}
					/>
				</div>
			</div>
		</div>,
		document.body,
	)
}

// Список менеджеров: клик по строке открывает персональный отчёт этого
// менеджера (тот же блок, что менеджер видит про себя).
function ManagerLeaderboard({
	items,
	showMoney,
	onSelect,
	emptyLabel = 'Нет заявок за период',
}) {
	if (items.length === 0) {
		return <div className='reports-empty'>{emptyLabel}</div>
	}

	const maxValue = Math.max(...items.map((item) => item.total), 1)

	return (
		<div className='reports-managers-list'>
			{items.map((item) => (
				<button
					key={item.id}
					type='button'
					className='reports-manager-row'
					onClick={() => onSelect(item.id)}
				>
					<span className='reports-manager-name' title={item.name}>
						{item.name}
						{item.role && item.role !== 'MANAGER' && (
							<span className='reports-manager-role'>
								{ROLE_LABELS[item.role] || item.role}
							</span>
						)}
					</span>

					<span className='reports-manager-bar'>
						<span
							className='reports-manager-bar-fill'
							style={{
								width: `${Math.max((item.total / maxValue) * 100, 4)}%`,
							}}
						/>
					</span>

					<span className='reports-manager-metric'>
						<b>{item.total}</b> заявок
					</span>

					{showMoney && (
						<span className='reports-manager-metric reports-manager-money'>
							{formatMoney(item.paidSum)}
						</span>
					)}

					<i className='fa-solid fa-chevron-right reports-manager-chevron'></i>
				</button>
			))}
		</div>
	)
}

// Столбчатый график заявок во времени — свой SVG, без внешних библиотек.
function TimeSeriesChart({ data, color = '#5e9424' }) {
	const [hoverIndex, setHoverIndex] = useState(null)

	if (data.length === 0) {
		return <div className='reports-empty'>Нет данных за выбранный период</div>
	}

	const maxCount = Math.max(...data.map((d) => d.count), 1)
	const barWidth = 26
	const gap = 12
	const chartHeight = 170
	const width = data.length * (barWidth + gap) + gap

	return (
		<div className='reports-chart-scroll'>
			<svg
				viewBox={`0 0 ${width} ${chartHeight + 36}`}
				width={Math.max(width, 320)}
				height={chartHeight + 36}
				className='reports-chart-svg'
			>
				{[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
					<line
						key={fraction}
						x1={0}
						x2={width}
						y1={chartHeight - chartHeight * fraction}
						y2={chartHeight - chartHeight * fraction}
						stroke='#eef1ea'
						strokeWidth='1'
					/>
				))}

				{data.map((d, i) => {
					const barHeight =
						maxCount === 0 ? 0 : (d.count / maxCount) * (chartHeight - 10)
					const x = gap + i * (barWidth + gap)
					const y = chartHeight - barHeight
					const isHovered = hoverIndex === i

					return (
						<g
							key={d.key}
							onMouseEnter={() => setHoverIndex(i)}
							onMouseLeave={() => setHoverIndex(null)}
							style={{ cursor: 'pointer' }}
						>
							<rect
								x={x}
								y={0}
								width={barWidth}
								height={chartHeight}
								fill='transparent'
							/>
							<rect
								x={x}
								y={y}
								width={barWidth}
								height={Math.max(barHeight, 2)}
								rx={4}
								fill={isHovered ? '#2e5902' : color}
								style={{ transition: 'fill 0.15s ease' }}
							/>
							<text
								x={x + barWidth / 2}
								y={chartHeight + 16}
								textAnchor='middle'
								fontSize='10'
								fill='#6b7280'
							>
								{d.label}
							</text>

							{isHovered && (
								<g>
									<rect
										x={x + barWidth / 2 - 16}
										y={Math.max(y - 24, 0)}
										width={32}
										height={20}
										rx={5}
										fill='#2e5902'
									/>
									<text
										x={x + barWidth / 2}
										y={Math.max(y - 24, 0) + 14}
										textAnchor='middle'
										fontSize='11'
										fontWeight='700'
										fill='#fff'
									>
										{d.count}
									</text>
								</g>
							)}
						</g>
					)
				})}
			</svg>
		</div>
	)
}

// Поле поиска клиента с выпадающим списком совпадений — список клиентов
// берём из уже загруженных заявок, отдельный запрос не нужен.
function ClientAutocomplete({ clients, value, onChange }) {
	const [query, setQuery] = useState('')
	const [isOpen, setIsOpen] = useState(false)
	const containerRef = useRef(null)

	useEffect(() => {
		if (!value) {
			setQuery('')
			return
		}

		const selected = clients.find((c) => c.key === value)
		setQuery(selected ? selected.label : '')
	}, [value, clients])

	useEffect(() => {
		const handleClickOutside = (e) => {
			if (containerRef.current && !containerRef.current.contains(e.target)) {
				setIsOpen(false)
			}
		}

		document.addEventListener('click', handleClickOutside)
		return () => document.removeEventListener('click', handleClickOutside)
	}, [])

	const filtered = clients
		.filter((c) => {
			const q = query.trim().toLowerCase()
			if (!q) return true

			return [c.label, c.phone]
				.filter(Boolean)
				.some((field) => String(field).toLowerCase().includes(q))
		})
		.slice(0, 50)

	const handlePick = (client) => {
		onChange(client.key)
		setQuery(client.label)
		setIsOpen(false)
	}

	const handleInputChange = (e) => {
		const nextValue = e.target.value
		setQuery(nextValue)
		setIsOpen(true)

		if (!nextValue.trim() && value) onChange('')
	}

	return (
		<div className='reports-client-picker' ref={containerRef}>
			<input
				type='text'
				className='reports-client-picker-input'
				autoComplete='off'
				placeholder='Все клиенты...'
				value={query}
				onFocus={() => setIsOpen(true)}
				onChange={handleInputChange}
			/>

			{isOpen && (
				<div className='reports-client-picker-dropdown'>
					{filtered.length === 0 ? (
						<div className='reports-client-picker-empty'>Ничего не найдено</div>
					) : (
						filtered.map((client) => (
							<button
								key={client.key}
								type='button'
								className='reports-client-picker-option'
								onClick={() => handlePick(client)}
							>
								<span className='reports-client-picker-option-name'>
									{client.label}
								</span>
								{client.phone && (
									<span className='reports-client-picker-option-meta'>
										{client.phone}
									</span>
								)}
							</button>
						))
					)}
				</div>
			)}
		</div>
	)
}

export default function Reports() {
	const userRole = getUserRole()
	const userId = getUserId()

	// Те же роли, что видят пункт "Отчёты" в сайдбаре.
	const canViewReports = [
		'ADMIN',
		'ROP',
		'MANAGER',
		'TECH_SUPPORT',
		'ACCOUNTANT',
	].includes(userRole)

	const [requests, setRequests] = useState([])
	const [cities, setCities] = useState([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')
	const [granularity, setGranularity] = useState('day')

	// Какое модальное окно открыто: 'clients' | 'technicians' | null
	const [openList, setOpenList] = useState(null)
	// Область для окна монтажников: только завершённые или все заявки
	const [technicianScope, setTechnicianScope] = useState('completed')

	// Личная статистика менеджера
	const [personalScope, setPersonalScope] = useState('all_mine')
	const [personalOnly, setPersonalOnly] = useState(false)

	// Режим отчёта для админа: общий по компании или по конкретному менеджеру
	const [reportMode, setReportMode] = useState('general')
	const [selectedManagerId, setSelectedManagerId] = useState('')

	const [filters, setFilters] = useState({
		client_key: '',
		date_from: '',
		date_to: '',
		city: '',
		work_type: '',
		status: '',
	})

	useEffect(() => {
		if (!canViewReports) return

		const fetchRequests = async () => {
			setLoading(true)
			setError('')

			try {
				const res = await fetch(`${API_BASE_URL}/requests`, {
					headers: getAuthHeaders(),
				})

				if (!res.ok) throw new Error('Не удалось загрузить заявки')

				const data = await res.json()
				setRequests(Array.isArray(data) ? data : [])
			} catch (err) {
				setError(err.message)
			} finally {
				setLoading(false)
			}
		}

		const fetchCities = async () => {
			try {
				const res = await fetch(`${API_BASE_URL}/cities`)
				if (res.ok) {
					const data = await res.json()
					setCities(Array.isArray(data) ? data : [])
				}
			} catch (err) {
				console.error('Ошибка загрузки городов:', err)
			}
		}

		fetchRequests()
		fetchCities()
	}, [canViewReports])

	const handleFilterChange = (e) =>
		setFilters((prev) => ({ ...prev, [e.target.name]: e.target.value }))

	const resetFilters = () =>
		setFilters({
			client_key: '',
			date_from: '',
			date_to: '',
			city: '',
			work_type: '',
			status: '',
		})

	const getFilterClassName = (name) =>
		filters[name] ? 'filter-input filter-active' : 'filter-input'

	const getFilterSelectClassName = (name) =>
		filters[name] ? 'filter-select filter-active' : 'filter-select'

	const isManagerView = userRole === 'MANAGER'
	const canSplitPersonal = isManagerView && userId != null

	// Кто может смотреть отчёты в разрезе менеджеров.
	const canViewManagerReports = ['ADMIN', 'ROP'].includes(userRole)
	const isManagerReportMode = canViewManagerReports && reportMode === 'manager'

	const selectedManagerIdNum = selectedManagerId ? Number(selectedManagerId) : null

	// Чью персональную статистику показываем: менеджер видит себя,
	// админ — выбранного менеджера.
	const personaId = isManagerView
		? userId
		: isManagerReportMode
			? selectedManagerIdNum
			: null

	// Для админа выбор менеджера сужает весь отчёт, для менеджера — только
	// если он сам поставил галочку.
	const applyPersonaToReport = isManagerView ? personalOnly : true

	// Заявки с общими фильтрами, но БЕЗ персонального среза — на них строится
	// список менеджеров, иначе после выбора одного остальные бы исчезли.
	const baseFilteredRequests = useMemo(() => {
		let result = requests

		if (filters.client_key)
			result = result.filter((r) => getClientKey(r) === filters.client_key)

		if (filters.date_from) {
			const from = new Date(filters.date_from)
			from.setHours(0, 0, 0, 0)
			result = result.filter((r) => new Date(r.created_at) >= from)
		}

		if (filters.date_to) {
			const to = new Date(filters.date_to)
			to.setHours(23, 59, 59, 999)
			result = result.filter((r) => new Date(r.created_at) <= to)
		}

		if (filters.city) result = result.filter((r) => r.city === filters.city)
		if (filters.work_type)
			result = result.filter((r) => r.work_type === filters.work_type)
		if (filters.status)
			result = result.filter((r) => r.status === filters.status)

		return result
	}, [requests, filters])

	const filteredRequests = useMemo(() => {
		if (personaId == null || !applyPersonaToReport) return baseFilteredRequests

		return baseFilteredRequests.filter((r) =>
			matchesPersonalScope(r, personalScope, personaId),
		)
	}, [baseFilteredRequests, personaId, applyPersonaToReport, personalScope])

	// Список клиентов для автодополнения строим по полному набору заявок
	// (не отфильтрованному) — иначе выбранный фильтр мог бы "спрятать" сам себя.
	const clientOptions = useMemo(() => {
		const map = new Map()

		requests.forEach((r) => {
			const key = getClientKey(r)

			if (!map.has(key)) {
				map.set(key, {
					key,
					label: getClientDisplayName(r),
					phone: r.phone || '',
				})
			}
		})

		return [...map.values()].sort((a, b) =>
			a.label.localeCompare(b.label, 'ru'),
		)
	}, [requests])

	// Заявки с учётом всех фильтров, КРОМЕ дат — нужны отдельно, чтобы
	// самим считать текущий/прошлый период для сравнения, а не то, что
	// уже отфильтровано по датам в filteredRequests.
	const requestsForComparison = useMemo(() => {
		let result = requests

		if (filters.client_key)
			result = result.filter((r) => getClientKey(r) === filters.client_key)
		if (filters.city) result = result.filter((r) => r.city === filters.city)
		if (filters.work_type)
			result = result.filter((r) => r.work_type === filters.work_type)
		if (filters.status)
			result = result.filter((r) => r.status === filters.status)

		return result
	}, [
		requests,
		filters.client_key,
		filters.city,
		filters.work_type,
		filters.status,
	])

	// Сравнение с прошлым периодом — только для недельной/месячной группировки
	// (для дней разница день-в-день слишком шумная на малых числах).
	const periodComparison = useMemo(() => {
		if (granularity === 'day') return null

		const current = getCurrentPeriodRange(granularity, filters)
		const previous = getPreviousPeriodRange(current, granularity)

		const countInRange = (from, to) =>
			requestsForComparison.filter((r) => {
				const created = new Date(r.created_at)
				if (Number.isNaN(created.getTime())) return false
				if (from && created < from) return false
				if (to && created > to) return false
				return true
			}).length

		const currentCount = countInRange(current.from, current.to)
		const previousCount = countInRange(previous.from, previous.to)

		let deltaPercent = null
		if (previousCount > 0) {
			deltaPercent = Math.round(
				((currentCount - previousCount) / previousCount) * 100,
			)
		}

		return { currentCount, previousCount, deltaPercent }
	}, [granularity, filters, requestsForComparison])

	const summary = useMemo(() => {
		const byStatus = { NEW: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0 }

		filteredRequests.forEach((r) => {
			if (byStatus[r.status] !== undefined) byStatus[r.status] += 1
		})

		return { total: filteredRequests.length, byStatus }
	}, [filteredRequests])

	const statusBars = useMemo(
		() =>
			Object.entries(STATUS_META).map(([key, meta]) => ({
				key,
				label: meta.label,
				color: meta.color,
				count: summary.byStatus[key] || 0,
			})),
		[summary],
	)

	// "Какие работы были выполнены" — считаем только среди завершённых заявок,
	// это и есть фактически выполненные работы, а не все заявки подряд.
	const workTypeBars = useMemo(() => {
		const counts = {}
		Object.keys(WORK_TYPE_META).forEach((key) => {
			counts[key] = 0
		})

		filteredRequests
			.filter((r) => r.status === 'COMPLETED')
			.forEach((r) => {
				if (counts[r.work_type] !== undefined) counts[r.work_type] += 1
			})

		return Object.entries(WORK_TYPE_META).map(([key, meta]) => ({
			key,
			label: meta.label,
			color: meta.color,
			count: counts[key],
		}))
	}, [filteredRequests])

	const completedWorkTotal = useMemo(
		() => workTypeBars.reduce((sum, bar) => sum + bar.count, 0),
		[workTypeBars],
	)

	const timeSeries = useMemo(() => {
		const buckets = {}

		filteredRequests.forEach((r) => {
			const key = getPeriodKey(r.created_at, granularity)
			if (!key) return
			buckets[key] = (buckets[key] || 0) + 1
		})

		return Object.keys(buckets)
			.sort()
			.map((key) => ({
				key,
				count: buckets[key],
				label: formatPeriodLabel(key, granularity),
			}))
	}, [filteredRequests, granularity])

	// Полный список клиентов (без обрезки) + разбивка: какие монтажники
	// работали по заявкам этого клиента. Топ-8 для карточки берём срезом ниже.
	const clientStats = useMemo(() => {
		const map = new Map()

		filteredRequests.forEach((r) => {
			const key = getClientKey(r)

			if (!map.has(key)) {
				map.set(key, {
					key,
					label: getClientDisplayName(r),
					count: 0,
					children: new Map(),
				})
			}

			const entry = map.get(key)
			entry.count += 1

			const executors = getRequestExecutors(r)
			const rows =
				executors.length > 0
					? executors.map((executor) => ({
							key: `tech-${executor.id}`,
							label: executor.name,
						}))
					: [{ key: 'tech-none', label: 'Монтажник не назначен' }]

			rows.forEach((row) => {
				if (!entry.children.has(row.key)) {
					entry.children.set(row.key, { ...row, count: 0 })
				}

				entry.children.get(row.key).count += 1
			})
		})

		return finalizeBreakdown(map, '#5e9424')
	}, [filteredRequests])

	// Монтажники по завершённым заявкам — это и есть "фактически выполнено".
	const technicianStats = useMemo(
		() =>
			buildTechnicianStats(
				filteredRequests.filter((r) => r.status === 'COMPLETED'),
			),
		[filteredRequests],
	)

	// Те же монтажники, но по заявкам любого статуса — чтобы в модальном окне
	// можно было увидеть всех, включая тех, у кого пока нет завершённых работ.
	const technicianStatsAll = useMemo(
		() => buildTechnicianStats(filteredRequests),
		[filteredRequests],
	)

	// Заявки для личной статистики: общие фильтры отчёта + личный срез.
	// Если галочка "применить ко всему отчёту" включена, срез уже учтён выше —
	// повторная фильтрация идемпотентна и ничего не ломает.
	const personalRequests = useMemo(() => {
		if (personaId == null) return filteredRequests

		return filteredRequests.filter((r) =>
			matchesPersonalScope(r, personalScope, personaId),
		)
	}, [filteredRequests, personaId, personalScope])

	// Цены менеджеру может быть не видно — бэкенд в этом случае обнуляет
	// total_price. Ориентируемся на флаг can_view_prices с самой заявки,
	// чтобы не показывать честный ноль вместо "нет доступа".
	const canViewPrices = useMemo(() => {
		if (requests.length === 0) return false

		return requests.some((r) =>
			typeof r.can_view_prices === 'boolean'
				? r.can_view_prices
				: r.total_price != null,
		)
	}, [requests])

	// Справочник менеджеров собираем из самих заявок — отдельный запрос
	// к /users не нужен, а менеджеры без единой заявки в отчёте всё равно пусты.
	const managerOptions = useMemo(() => {
		const map = new Map()

		const put = (id, name, role) => {
			if (id == null) return

			const key = Number(id)
			if (!Number.isFinite(key)) return

			const existing = map.get(key)

			if (existing) {
				if (name && existing.name.startsWith('ID:')) existing.name = name
				if (role && !existing.role) existing.role = role
				return
			}

			map.set(key, { id: key, name: name || `ID: ${key}`, role: role || null })
		}

		requests.forEach((r) => {
			put(r.responsible_manager_id, r.responsible_manager_name, null)

			if (r.created_by_role === 'MANAGER') {
				put(r.created_by, r.created_by_name, 'MANAGER')
			}
		})

		return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
	}, [requests])

	const selectedManager = useMemo(
		() => managerOptions.find((m) => m.id === selectedManagerIdNum) || null,
		[managerOptions, selectedManagerIdNum],
	)

	// Рейтинг менеджеров — по тому же срезу, что и персональная статистика,
	// чтобы цифры в списке и внутри отчёта менеджера совпадали.
	const managerLeaderboard = useMemo(() => {
		if (!canViewManagerReports) return []

		const byId = new Map(
			managerOptions.map((m) => [
				m.id,
				{ ...m, total: 0, completed: 0, paidSum: 0, clients: new Set() },
			]),
		)

		baseFilteredRequests.forEach((r) => {
			getScopeOwnerIds(r, personalScope).forEach((ownerId) => {
				const entry = byId.get(ownerId)
				if (!entry) return

				entry.total += 1
				entry.clients.add(getClientKey(r))

				if (r.status === 'COMPLETED') entry.completed += 1
				if (r.is_paid) entry.paidSum += toNumber(r.total_price)
			})
		})

		return [...byId.values()]
			.filter((entry) => entry.total > 0)
			.map((entry) => ({ ...entry, clients: entry.clients.size }))
			.sort(
				(a, b) =>
					b.paidSum - a.paidSum ||
					b.total - a.total ||
					a.name.localeCompare(b.name, 'ru'),
			)
	}, [canViewManagerReports, managerOptions, baseFilteredRequests, personalScope])

	const personalSummary = useMemo(() => {
		const clientKeys = new Set()

		let completed = 0
		let inProgress = 0
		let paidSum = 0
		let paidCount = 0
		let pendingSum = 0
		let pendingCount = 0

		personalRequests.forEach((r) => {
			clientKeys.add(getClientKey(r))

			if (r.status === 'COMPLETED') completed += 1
			if (r.status === 'IN_PROGRESS') inProgress += 1

			const price = toNumber(r.total_price)

			// is_paid проставляют только ADMIN/ROP/ACCOUNTANT — это и есть
			// реально полученные деньги, а не ожидаемые.
			if (r.is_paid) {
				paidSum += price
				paidCount += 1
			} else if (r.status !== 'CANCELLED') {
				pendingSum += price
				pendingCount += 1
			}
		})

		return {
			total: personalRequests.length,
			clients: clientKeys.size,
			completed,
			inProgress,
			paidSum,
			paidCount,
			pendingSum,
			pendingCount,
			averageCheck: paidCount > 0 ? paidSum / paidCount : 0,
		}
	}, [personalRequests])

	// Мои клиенты по оплаченной выручке + разбивка по типам работ внутри клиента.
	const personalClientRevenue = useMemo(() => {
		const map = new Map()

		personalRequests
			.filter((r) => r.is_paid)
			.forEach((r) => {
				const key = getClientKey(r)
				const price = toNumber(r.total_price)

				if (!map.has(key)) {
					map.set(key, {
						key,
						label: getClientDisplayName(r),
						count: 0,
						children: new Map(),
					})
				}

				const entry = map.get(key)
				entry.count += price

				const workKey = r.work_type || 'OTHER'
				const workLabel = WORK_TYPE_META[workKey]?.label || 'Другое'

				if (!entry.children.has(workKey)) {
					entry.children.set(workKey, {
						key: workKey,
						label: workLabel,
						count: 0,
					})
				}

				entry.children.get(workKey).count += price
			})

		return finalizeBreakdown(map, '#2e7d32')
	}, [personalRequests])

	const technicianModalItems =
		technicianScope === 'all' ? technicianStatsAll : technicianStats

	if (!canViewReports) {
		return (
			<div className='requests-page-container'>
				<div className='empty-state'>
					Недостаточно прав для просмотра отчётов
				</div>
			</div>
		)
	}

	return (
		<div className='requests-page-container'>
			<div className='reports-header'>
				<div>
					<h2>Отчёты по заявкам</h2>
					<p className='reports-subtitle'>
						Сколько заявок было, какие работы выполнены и у каких клиентов.
					</p>
				</div>

				{canViewManagerReports && (
					<div className='reports-mode-switch'>
						<div className='reports-granularity-toggle'>
							<button
								type='button'
								className={`reports-granularity-btn ${
									reportMode === 'general' ? 'active' : ''
								}`}
								onClick={() => {
									setReportMode('general')
									setSelectedManagerId('')
								}}
							>
								Общий отчёт
							</button>

							<button
								type='button'
								className={`reports-granularity-btn ${
									reportMode === 'manager' ? 'active' : ''
								}`}
								onClick={() => setReportMode('manager')}
							>
								По менеджерам
							</button>
						</div>

						{isManagerReportMode && (
							<select
								className={
									selectedManagerId
										? 'filter-select filter-active'
										: 'filter-select'
								}
								value={selectedManagerId}
								onChange={(e) => setSelectedManagerId(e.target.value)}
							>
								<option value=''>Все менеджеры (список)</option>
								{managerOptions.map((manager) => (
									<option key={manager.id} value={manager.id}>
										{manager.name}
										{manager.role && manager.role !== 'MANAGER'
											? ` (${ROLE_LABELS[manager.role] || manager.role})`
											: ''}
									</option>
								))}
							</select>
						)}
					</div>
				)}
			</div>

			{userRole === 'MANAGER' && (
				<div className='reports-scope-note'>
					Отчёт построен по заявкам, доступным вашей роли: созданные вами и
					заявки клиентов, где вы ответственный менеджер — не по всей компании.
				</div>
			)}

			<div className='filters-bar'>
				<div className='filter-group filter-main'>
					<label>Клиент</label>
					<ClientAutocomplete
						clients={clientOptions}
						value={filters.client_key}
						onChange={(value) =>
							setFilters((prev) => ({ ...prev, client_key: value }))
						}
					/>
				</div>

				<div className='filter-group'>
					<label>Дата создания от:</label>
					<input
						className={getFilterClassName('date_from')}
						type='date'
						name='date_from'
						value={filters.date_from}
						onChange={handleFilterChange}
					/>
				</div>

				<div className='filter-group'>
					<label>до:</label>
					<input
						className={getFilterClassName('date_to')}
						type='date'
						name='date_to'
						value={filters.date_to}
						onChange={handleFilterChange}
					/>
				</div>

				<div className='filter-group'>
					<label>Город</label>
					<select
						className={getFilterSelectClassName('city')}
						name='city'
						value={filters.city}
						onChange={handleFilterChange}
					>
						<option value=''>Все города</option>
						{cities.map((city) => (
							<option key={city.id} value={city.name}>
								{city.name}
							</option>
						))}
					</select>
				</div>

				<div className='filter-group'>
					<label>Тип работ</label>
					<select
						className={getFilterSelectClassName('work_type')}
						name='work_type'
						value={filters.work_type}
						onChange={handleFilterChange}
					>
						<option value=''>Все типы</option>
						{Object.entries(WORK_TYPE_META).map(([key, meta]) => (
							<option key={key} value={key}>
								{meta.label}
							</option>
						))}
					</select>
				</div>

				<div className='filter-group'>
					<label>Статус</label>
					<select
						className={getFilterSelectClassName('status')}
						name='status'
						value={filters.status}
						onChange={handleFilterChange}
					>
						<option value=''>Все статусы</option>
						{Object.entries(STATUS_META).map(([key, meta]) => (
							<option key={key} value={key}>
								{meta.label}
							</option>
						))}
					</select>
				</div>

				<button className='btn-reset' onClick={resetFilters}>
					Сбросить
				</button>
			</div>

			{error && <div className='error-message'>{error}</div>}

			{loading ? (
				<div>Загрузка...</div>
			) : (
				<>
					{isManagerReportMode && !selectedManager && (
						<div className='reports-card reports-personal'>
							<div className='reports-card-header'>
								<h3>Менеджеры</h3>

								<div className='reports-granularity-toggle'>
									{PERSONAL_SCOPE_OPTIONS.map((option) => (
										<button
											key={option.value}
											type='button'
											className={`reports-granularity-btn ${
												personalScope === option.value ? 'active' : ''
											}`}
											onClick={() => setPersonalScope(option.value)}
										>
											{option.label}
										</button>
									))}
								</div>
							</div>

							<div className='reports-personal-hint'>
								{PERSONAL_SCOPE_HINT}. Клик по менеджеру откроет его отчёт.
							</div>

							<ManagerLeaderboard
								items={managerLeaderboard}
								showMoney={canViewPrices}
								onSelect={(id) => setSelectedManagerId(String(id))}
								emptyLabel='Нет заявок с назначенным менеджером за период'
							/>
						</div>
					)}

					{personaId != null && (
						<div className='reports-card reports-personal'>
							<div className='reports-card-header'>
								<h3>
									{isManagerView
										? 'Моя статистика'
										: `Отчёт менеджера: ${selectedManager?.name || ''}`}
								</h3>

								{isManagerReportMode && (
									<button
										type='button'
										className='reports-card-link'
										onClick={() => setSelectedManagerId('')}
									>
										<i className='fa-solid fa-chevron-left'></i>К списку
										менеджеров
									</button>
								)}

								{canSplitPersonal || isManagerReportMode ? (
									<div className='reports-granularity-toggle'>
										{PERSONAL_SCOPE_OPTIONS.map((option) => (
											<button
												key={option.value}
												type='button'
												className={`reports-granularity-btn ${
													personalScope === option.value ? 'active' : ''
												}`}
												onClick={() => setPersonalScope(option.value)}
											>
												{option.label}
											</button>
										))}
									</div>
								) : (
									<span className='reports-card-header-note'>
										все доступные вам заявки
									</span>
								)}
							</div>

							{(canSplitPersonal || isManagerReportMode) && (
								<div className='reports-personal-hint reports-personal-hint-top'>
									{PERSONAL_SCOPE_HINT}
								</div>
							)}

							<div className='reports-summary-cards reports-personal-cards'>
								<div className='reports-summary-card reports-summary-card-main'>
									<div className='reports-summary-value'>
										{personalSummary.clients}
									</div>
									<div className='reports-summary-label'>
										{isManagerView ? 'Моих клиентов' : 'Клиентов'}
									</div>
								</div>

								<div className='reports-summary-card'>
									<div className='reports-summary-value'>
										{personalSummary.total}
									</div>
									<div className='reports-summary-label'>
										{isManagerView ? 'Моих заявок' : 'Заявок'}
									</div>
								</div>

								<div className='reports-summary-card'>
									<div
										className='reports-summary-value'
										style={{ color: '#2e7d32' }}
									>
										{personalSummary.completed}
									</div>
									<div className='reports-summary-label'>Завершено</div>
								</div>

								{canViewPrices && (
									<>
										<div className='reports-summary-card reports-summary-card-money'>
											<div className='reports-summary-value reports-summary-value-money'>
												{formatMoney(personalSummary.paidSum)}
											</div>
											<div className='reports-summary-label'>
												Оплачено ({personalSummary.paidCount})
											</div>
										</div>

										<div className='reports-summary-card'>
											<div className='reports-summary-value reports-summary-value-money'>
												{formatMoney(personalSummary.pendingSum)}
											</div>
											<div className='reports-summary-label'>
												Ждёт оплаты ({personalSummary.pendingCount})
											</div>
										</div>

										<div className='reports-summary-card'>
											<div className='reports-summary-value reports-summary-value-money'>
												{formatMoney(personalSummary.averageCheck)}
											</div>
											<div className='reports-summary-label'>Средний чек</div>
										</div>
									</>
								)}
							</div>

							{!canViewPrices && (
								<div className='reports-personal-hint'>
									Суммы скрыты: у вашей роли нет доступа к ценам заявок.
								</div>
							)}

							{canViewPrices && (
								<div className='reports-personal-revenue'>
									<div className='reports-card-header'>
										<h3>
											{isManagerView ? 'Мои клиенты' : 'Клиенты'} по оплаченной
											выручке
										</h3>

										{personalClientRevenue.length > 0 && (
											<button
												type='button'
												className='reports-card-link'
												onClick={() => setOpenList('personal_revenue')}
											>
												Все клиенты ({personalClientRevenue.length})
												<i className='fa-solid fa-up-right-and-down-left-from-center'></i>
											</button>
										)}
									</div>

									<BreakdownList
										items={personalClientRevenue.slice(0, 5)}
										emptyLabel='Оплаченных заявок за период нет'
										childFillColor='#9ab873'
										formatValue={formatMoney}
									/>
								</div>
							)}

							{canSplitPersonal && (
								<label className='reports-personal-apply'>
									<input
										type='checkbox'
										checked={personalOnly}
										onChange={(e) => setPersonalOnly(e.target.checked)}
									/>
									Показывать во всём отчёте ниже только эти заявки
								</label>
							)}
						</div>
					)}

					<div className='reports-summary-cards'>
						<div className='reports-summary-card reports-summary-card-main'>
							<div className='reports-summary-value'>{summary.total}</div>
							<div className='reports-summary-label'>Всего заявок</div>
						</div>

						{statusBars.map((bar) => (
							<div key={bar.key} className='reports-summary-card'>
								<div
									className='reports-summary-value'
									style={{ color: bar.color }}
								>
									{bar.count}
								</div>
								<div className='reports-summary-label'>{bar.label}</div>
							</div>
						))}
					</div>

					<div className='reports-card'>
						<div className='reports-card-header'>
							<h3>Заявки во времени</h3>

							<div className='reports-granularity-toggle'>
								{GRANULARITY_OPTIONS.map((option) => (
									<button
										key={option.value}
										type='button'
										className={`reports-granularity-btn ${
											granularity === option.value ? 'active' : ''
										}`}
										onClick={() => setGranularity(option.value)}
									>
										{option.label}
									</button>
								))}
							</div>
						</div>

						{periodComparison && (
							<div
								className={`reports-period-delta ${
									periodComparison.deltaPercent > 0
										? 'is-up'
										: periodComparison.deltaPercent < 0
											? 'is-down'
											: ''
								}`}
							>
								<span className='reports-period-delta-count'>
									{periodComparison.currentCount}{' '}
									{granularity === 'month' ? 'в этом месяце' : 'на этой неделе'}
								</span>

								{periodComparison.deltaPercent === null ? (
									<span className='reports-period-delta-note'>
										нет данных за прошл
										{granularity === 'month' ? 'ый месяц' : 'ую неделю'} для
										сравнения
									</span>
								) : (
									<span className='reports-period-delta-badge'>
										<i
											className={`fa-solid ${
												periodComparison.deltaPercent >= 0
													? 'fa-arrow-trend-up'
													: 'fa-arrow-trend-down'
											}`}
										></i>
										{periodComparison.deltaPercent > 0 ? '+' : ''}
										{periodComparison.deltaPercent}% к прошл
										{granularity === 'month' ? 'ому месяцу' : 'ой неделе'} (
										{periodComparison.previousCount})
									</span>
								)}
							</div>
						)}

						<TimeSeriesChart data={timeSeries} />
					</div>

					<div className='reports-grid-2'>
						<div className='reports-card'>
							<div className='reports-card-header'>
								<h3>Какие работы выполнены</h3>
								<span className='reports-card-header-note'>
									{completedWorkTotal} завершённых заявок
								</span>
							</div>

							<BarList
								items={workTypeBars}
								emptyLabel='Нет завершённых заявок за период'
							/>
						</div>

						<div className='reports-card'>
							<div className='reports-card-header'>
								<h3>Заявки по статусам</h3>
							</div>

							<BarList items={statusBars} />
						</div>
					</div>

					<div className='reports-grid-2'>
						<div className='reports-card'>
							<div className='reports-card-header'>
								<h3>Клиенты и кол-во заявок</h3>

								{clientStats.length > 0 && (
									<button
										type='button'
										className='reports-card-link'
										onClick={() => setOpenList('clients')}
									>
										Все клиенты ({clientStats.length})
										<i className='fa-solid fa-up-right-and-down-left-from-center'></i>
									</button>
								)}
							</div>

							<BreakdownList
								items={clientStats.slice(0, 8)}
								emptyLabel='Нет заявок за период'
								childFillColor='#b9cde6'
							/>
						</div>

						<div className='reports-card'>
							<div className='reports-card-header'>
								<h3>Монтажники и кол-во выполненных заявок</h3>

								{technicianStats.length > 0 && (
									<button
										type='button'
										className='reports-card-link'
										onClick={() => setOpenList('technicians')}
									>
										Все монтажники ({technicianStats.length})
										<i className='fa-solid fa-up-right-and-down-left-from-center'></i>
									</button>
								)}
							</div>

							<BreakdownList
								items={technicianStats.slice(0, 8)}
								emptyLabel='Нет завершённых заявок за период'
								childFillColor='#b9cde6'
							/>
						</div>
					</div>
				</>
			)}

			{openList === 'clients' && (
				<ReportsListModal
					title='Все клиенты с заявками'
					note='Клик по клиенту — какие монтажники работали по его заявкам. Учтены все фильтры отчёта.'
					items={clientStats}
					searchPlaceholder='Поиск по клиенту или монтажнику...'
					emptyLabel='Нет заявок за период'
					totalLabel='Всего заявок'
					childFillColor='#b9cde6'
					onClose={() => setOpenList(null)}
				/>
			)}

			{openList === 'personal_revenue' && (
				<ReportsListModal
					title='Мои клиенты по оплаченной выручке'
					note='Только заявки, отмеченные как оплаченные. Клик по клиенту — разбивка по типам работ.'
					items={personalClientRevenue}
					searchPlaceholder='Поиск по клиенту...'
					emptyLabel='Оплаченных заявок за период нет'
					totalLabel='Итого'
					childFillColor='#9ab873'
					formatValue={formatMoney}
					onClose={() => setOpenList(null)}
				/>
			)}

			{openList === 'technicians' && (
				<ReportsListModal
					title='Все монтажники'
					note='Клик по монтажнику — каким клиентам и сколько раз он выезжал. Учтены все фильтры отчёта.'
					items={technicianModalItems}
					searchPlaceholder='Поиск по монтажнику или клиенту...'
					emptyLabel={
						technicianScope === 'all'
							? 'Нет заявок с назначенными монтажниками'
							: 'Нет завершённых заявок за период'
					}
					totalLabel={
						technicianScope === 'all' ? 'Всего назначений' : 'Всего выполнено'
					}
					childFillColor='#9ab873'
					toolbarExtra={
						<div className='reports-granularity-toggle'>
							<button
								type='button'
								className={`reports-granularity-btn ${
									technicianScope === 'completed' ? 'active' : ''
								}`}
								onClick={() => setTechnicianScope('completed')}
							>
								Завершённые
							</button>

							<button
								type='button'
								className={`reports-granularity-btn ${
									technicianScope === 'all' ? 'active' : ''
								}`}
								onClick={() => setTechnicianScope('all')}
							>
								Все заявки
							</button>
						</div>
					}
					onClose={() => setOpenList(null)}
				/>
			)}
		</div>
	)
}