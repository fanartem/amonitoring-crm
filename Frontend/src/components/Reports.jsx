import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
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
// Переход из отчёта на саму заявку. Страница заявок ловит id через
// location.state — так же, как склад ловит highlightWarehouseItemId.
// Если у вас на странице заявок ключ называется иначе — менять здесь.
const REQUESTS_ROUTE = '/requests'
const REQUEST_STATE_KEY = 'highlightRequestId'

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
					requests: [],
					children: new Map(),
				})
			}

			const entry = map.get(executor.id)
			entry.count += 1
			entry.requests.push(r)

			if (!entry.children.has(clientKey)) {
				entry.children.set(clientKey, {
					key: clientKey,
					label: clientLabel,
					count: 0,
					requests: [],
				})
			}

			const child = entry.children.get(clientKey)
			child.count += 1
			child.requests.push(r)
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

// Список конкретных заявок — чтобы видеть не только "монтажник сделал 12",
// но и какие именно это были заявки.
function RequestListModal({ title, note, requests, onOpenRequest, onClose }) {
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

	const sorted = [...requests].sort(
		(a, b) => new Date(b.created_at) - new Date(a.created_at),
	)

	const filtered = normalizedQuery
		? sorted.filter((r) =>
				[
					String(r.id),
					getClientDisplayName(r),
					r.address,
					r.city,
					WORK_TYPE_META[r.work_type]?.label,
					STATUS_META[r.status]?.label,
				]
					.filter(Boolean)
					.some((field) => String(field).toLowerCase().includes(normalizedQuery)),
			)
		: sorted

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
						placeholder='Поиск по номеру, клиенту, адресу...'
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
				</div>

				<div className='reports-modal-meta'>
					<span>
						Показано {filtered.length} из {requests.length}
					</span>
				</div>

				<div className='reports-modal-body'>
					{filtered.length === 0 ? (
						<div className='reports-empty'>Ничего не найдено</div>
					) : (
						<div className='reports-request-list'>
							{filtered.map((r) => {
								const status = STATUS_META[r.status]
								const work = WORK_TYPE_META[r.work_type]

								return (
									<div
										key={r.id}
										className={`reports-request-row ${
											onOpenRequest ? 'is-clickable' : ''
										}`}
										role={onOpenRequest ? 'button' : undefined}
										tabIndex={onOpenRequest ? 0 : undefined}
										onClick={onOpenRequest ? () => onOpenRequest(r) : undefined}
										onKeyDown={
											onOpenRequest
												? (e) => {
														if (e.key === 'Enter' || e.key === ' ') {
															e.preventDefault()
															onOpenRequest(r)
														}
													}
												: undefined
										}
										title={onOpenRequest ? 'Открыть заявку' : undefined}
									>
										<div className='reports-request-main'>
											<span className='reports-request-id'>№{r.id}</span>

											<span
												className='reports-request-client'
												title={getClientDisplayName(r)}
											>
												{getClientDisplayName(r)}
											</span>

											{status && (
												<span
													className='reports-request-status'
													style={{
														background: `${status.color}1a`,
														color: status.color,
													}}
												>
													{status.label}
												</span>
											)}

											{onOpenRequest && (
												<i className='fa-solid fa-arrow-right reports-request-go'></i>
											)}
										</div>

										<div className='reports-request-meta'>
											<span>{formatShortDate(r.created_at)}</span>
											{work && <span>{work.label}</span>}
											{r.city && <span>{r.city}</span>}
											{r.address && (
												<span className='reports-request-address' title={r.address}>
													{r.address}
												</span>
											)}
										</div>
									</div>
								)
							})}
						</div>
					)}
				</div>
			</div>
		</div>,
		document.body,
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
	onShowRequests = null,
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
						<div className='reports-row-head'>
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

						{onShowRequests && item.requests?.length > 0 && (
							<button
								type='button'
								className='reports-row-requests-btn'
								onClick={() => onShowRequests(item, null)}
								title='Показать список заявок'
							>
								<i className='fa-solid fa-list-ul'></i>
								Заявки
							</button>
						)}
						</div>

						{isOpen && (
							<div className='reports-tech-clients'>
								{children.map((child) => {
									const clickable = Boolean(
										onShowRequests && child.requests?.length > 0,
									)

									return (
									<div
										key={child.key}
										className={`reports-tech-client-row ${
											clickable ? 'is-clickable' : ''
										}`}
										role={clickable ? 'button' : undefined}
										tabIndex={clickable ? 0 : undefined}
										onClick={
											clickable ? () => onShowRequests(item, child) : undefined
										}
										onKeyDown={
											clickable
												? (e) => {
														if (e.key === 'Enter' || e.key === ' ') {
															e.preventDefault()
															onShowRequests(item, child)
														}
													}
												: undefined
										}
										title={clickable ? 'Показать заявки' : undefined}
									>
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
									)
								})}
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
	onShowRequests = null,
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
						onShowRequests={onShowRequests}
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

// === Отчёт по складу ===
// Массовой выгрузки движений в API нет — историю приходится собирать по
// каждой позиции (/warehouse/items/{id}/history), поэтому агрегация здесь.

// При перемещении расходников пишутся ДВЕ записи (списание из исходной
// позиции и зачисление в целевую) с одинаковыми городами и количеством.
// Считаем только одну из пары, иначе цифры удвоятся.
const WAREHOUSE_DUPLICATE_ACTIONS = new Set([
	'CONSUMABLE_TRANSFERRED_IN',
	'IMPORT_CONSUMABLE_TRANSFERRED_IN',
	'CONSUMABLE_INVENTORY_TRANSFERRED_IN',
	'CONSUMABLE_INVENTORY_TRANSFERRED_TO_STOCK_IN',
	'CONSUMABLE_ASSIGNED_TO_TECH',
	'CONSUMABLE_RETURNED_TO_STOCK',
])

// Не меняют количество на складе
const WAREHOUSE_IGNORED_ACTIONS = new Set(['UPDATED'])

// Действие задаёт только причину. Направление (приход/расход) считается по
// городам самой записи, поэтому новый тип действия не выпадет из отчёта.
const WAREHOUSE_ACTION_REASONS = {
	CREATED: 'NEW',
	IMPORT_CREATED: 'NEW',
	IMPORT_CONSUMABLE_ADDED: 'NEW',
	MANUAL_ADDED_TO_TECH: 'NEW',
	MANUAL_CONSUMABLE_ADDED_TO_TECH: 'NEW',
	RESTORED: 'RESTORED',

	CITY_TRANSFERRED: 'TRANSFER',
	CITY_CHANGED: 'TRANSFER',
	CONSUMABLE_TRANSFERRED_OUT: 'TRANSFER',
	IMPORT_SERIALIZED_TRANSFERRED: 'TRANSFER',
	IMPORT_CONSUMABLE_TRANSFERRED_OUT: 'TRANSFER',

	ASSIGNED_TO_TECH: 'TO_TECH',
	CONSUMABLE_ASSIGNED_OUT: 'TO_TECH',
	INVENTORY_TRANSFERRED_TO_USER: 'TO_TECH',
	CONSUMABLE_INVENTORY_TRANSFERRED_OUT: 'TO_TECH',

	RETURNED_TO_STOCK: 'FROM_TECH',
	CONSUMABLE_RETURNED_FROM_TECH_OUT: 'FROM_TECH',
	INVENTORY_TRANSFERRED_TO_STOCK: 'FROM_TECH',
	CONSUMABLE_INVENTORY_TRANSFERRED_TO_STOCK_OUT: 'FROM_TECH',
	RETURNED_FROM_USER: 'FROM_TECH',

	DETACHED_FROM_REQUEST: 'FROM_REQUEST',
	DETACHED_FROM_VEHICLE_DIRECT: 'FROM_REQUEST',
	REMOVAL_COMPLETED_MARKED_USED: 'FROM_REQUEST',
	RETURNABLE_CONSUMABLE_RETURNED_AFTER_REMOVAL: 'FROM_REQUEST',

	ATTACHED_TO_REQUEST: 'INSTALLED',
	INSTALLED_FROM_STOCK: 'INSTALLED',
	INSTALLED_FROM_TECH: 'INSTALLED',
	INSTALLED_TO_VEHICLE_DIRECT: 'INSTALLED',
	ISSUED_TO_USER: 'TO_TECH',
	CONSUMABLE_USED_FROM_STOCK: 'INSTALLED',
	CONSUMABLE_USED_FROM_TECH: 'INSTALLED',
	CONSUMABLE_USED_TO_VEHICLE_DIRECT: 'INSTALLED',

	WRITTEN_OFF: 'WRITTEN_OFF',
	DELETED: 'WRITTEN_OFF',
}

// Выдача на руки монтажнику: у этих движений заполнен target_user_id
const WAREHOUSE_ISSUE_ACTIONS = new Set([
	'ASSIGNED_TO_TECH',
	'CONSUMABLE_ASSIGNED_OUT',
	'INVENTORY_TRANSFERRED_TO_USER',
	'CONSUMABLE_INVENTORY_TRANSFERRED_OUT',
	'MANUAL_ADDED_TO_TECH',
	'MANUAL_CONSUMABLE_ADDED_TO_TECH',
	'ISSUED_TO_USER',
])

// Возврат от монтажника: заполнен from_user_id
const WAREHOUSE_RETURN_ACTIONS = new Set([
	'RETURNED_TO_STOCK',
	'CONSUMABLE_RETURNED_FROM_TECH_OUT',
	'INVENTORY_TRANSFERRED_TO_STOCK',
	'CONSUMABLE_INVENTORY_TRANSFERRED_TO_STOCK_OUT',
	'RETURNED_FROM_USER',
])

const WAREHOUSE_REASON_LABELS = {
	NEW: 'Новое поступление',
	RESTORED: 'Восстановлено из корзины',
	TRANSFER: 'Перемещение между городами',
	TO_TECH: 'Выдано монтажнику',
	FROM_TECH: 'Возврат от монтажника',
	FROM_REQUEST: 'Снято / отвязано от заявки',
	INSTALLED: 'Установлено / израсходовано',
	WRITTEN_OFF: 'Списание и удаление',
	OTHER: 'Прочее',
}

const WAREHOUSE_CATEGORIES = {
	GPS_TRACKER: 'Трекер',
	BEACON: 'Маяк',
	FUEL_SENSOR: 'ДУТ',
	BLE_SENSOR: 'BLE-датчик',
	WIRED_SENSOR: 'Пров. датчик',
	RELAY: 'Реле',
	CABLE: 'Кабель',
	CONSUMABLE: 'Расходники',
	TOOLS: 'Инструменты',
	FIRST_AID: 'Аптечки',
	OTHER: 'Другое',
}

// IMEI / MAC / серийник — то, по чему позицию узнают на складе
const formatIdentifier = (row) => {
	const value = row.identifier_value || row.serial_number

	if (!value) return null

	const type =
		row.identifier_type && row.identifier_type !== 'NONE'
			? row.identifier_type
			: 'S/N'

	return `${type} ${value}`
}

const formatShortDate = (value) => {
	if (!value) return ''

	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return ''

	return date.toLocaleDateString('ru-RU', {
		day: '2-digit',
		month: '2-digit',
		year: '2-digit',
	})
}

const emptyBucket = () => ({ devices: 0, consumables: 0, total: 0 })

const addToBucket = (bucket, kind, qty) => {
	bucket[kind] += qty
	bucket.total += qty
}

// Ограниченная параллельность: история тянется по одной позиции, без лимита
// это сотни одновременных запросов к API.
const runWithConcurrency = async (list, limit, worker, onProgress, isCancelled) => {
	let index = 0
	let done = 0

	const runners = Array.from(
		{ length: Math.min(limit, list.length) },
		async () => {
			while (index < list.length) {
				if (isCancelled()) return

				const current = list[index++]

				try {
					await worker(current)
				} catch (err) {
					// Одна позиция не должна ронять весь отчёт
					console.error('Ошибка истории позиции:', err)
				}

				done += 1
				onProgress(done, list.length)
			}
		},
	)

	await Promise.all(runners)
}

// Сборка приход/расход из плоского списка движений.
const aggregateWarehouseMovements = (movements, { dateFrom, dateTo, cityId }) => {
	const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null
	const to = dateTo ? new Date(`${dateTo}T23:59:59`) : null
	const cityFilter = cityId ? Number(cityId) : null

	const cities = new Map()
	const routes = new Map()
	const items = new Map()
	const unknownActions = new Set()

	// Детализация: что именно уехало в отправках и что выдано монтажникам
	const transfers = new Map()
	const technicians = new Map()

	// Устройства перечисляем поштучно (важен IMEI и номер заявки), расходники —
	// суммой по названию, иначе список превратится в километровую простыню.
	const pushDetail = (deviceList, consumableMap, m, qty) => {
		if (m.is_serialized) {
			deviceList.push({
				key: `${m.item_id}-${m.created_at}-${m.action}`,
				item_id: m.item_id,
				name: m.item_name,
				identifier: formatIdentifier(m),
				date: m.created_at,
				request_id: m.request_id,
			})

			return
		}

		const key = `${m.item_name}|${m.category}`

		if (!consumableMap.has(key)) {
			consumableMap.set(key, {
				key,
				name: m.item_name,
				category: m.category,
				qty: 0,
				request_ids: new Set(),
			})
		}

		const row = consumableMap.get(key)
		row.qty += qty
		if (m.request_id) row.request_ids.add(m.request_id)
	}

	// Бакет причины: счётчики и детализация лежат под разными именами
	const emptyReasonBucket = () => ({
		...emptyBucket(),
		deviceList: [],
		consumableMap: new Map(),
	})

	const totals = {
		in: emptyBucket(),
		out: emptyBucket(),
		transfer: emptyBucket(),
		internal: emptyBucket(),
	}

	const cityEntry = (id, name) => {
		const key = id == null ? 'none' : String(id)

		if (!cities.has(key)) {
			cities.set(key, {
				key,
				city_id: id,
				city_name: name || 'Город не указан',
				in: emptyBucket(),
				out: emptyBucket(),
				internal: emptyBucket(),
				in_reasons: new Map(),
				out_reasons: new Map(),
				internal_reasons: new Map(),
			})
		}

		const entry = cities.get(key)
		if (name && entry.city_name === 'Город не указан') entry.city_name = name

		return entry
	}

	const add = (id, name, direction, reason, kind, qty, movement) => {
		const entry = cityEntry(id, name)
		addToBucket(entry[direction], kind, qty)

		const reasons = entry[`${direction}_reasons`]
		if (!reasons.has(reason)) reasons.set(reason, emptyReasonBucket())

		const bucket = reasons.get(reason)
		addToBucket(bucket, kind, qty)
		pushDetail(bucket.deviceList, bucket.consumableMap, movement, qty)
	}

	movements.forEach((m) => {
		if (WAREHOUSE_IGNORED_ACTIONS.has(m.action)) return
		if (WAREHOUSE_DUPLICATE_ACTIONS.has(m.action)) return

		if (from || to) {
			const created = new Date(m.created_at)
			if (from && created < from) return
			if (to && created > to) return
		}

		const qty = Math.abs(Number(m.quantity)) || 1
		const kind = m.is_serialized ? 'devices' : 'consumables'

		if (!WAREHOUSE_ACTION_REASONS[m.action]) unknownActions.add(m.action)
		const reason = WAREHOUSE_ACTION_REASONS[m.action] || 'OTHER'

		let source = m.from_city_id != null ? Number(m.from_city_id) : null
		let sourceName = m.from_city_name
		const target = m.to_city_id != null ? Number(m.to_city_id) : null

		// Списание городов не пишет — берём город самой позиции
		if (source == null && target == null) {
			source = m.item_city_id != null ? Number(m.item_city_id) : null
			sourceName = m.item_city_name
		}

		const touchesCity =
			cityFilter == null || source === cityFilter || target === cityFilter

		if (!touchesCity) return

		const itemKey = `${m.item_name}|${m.category}|${m.is_serialized}`

		if (!items.has(itemKey)) {
			items.set(itemKey, {
				key: itemKey,
				name: m.item_name,
				category: m.category,
				is_serialized: m.is_serialized,
				qty_in: 0,
				qty_out: 0,
			})
		}

		const item = items.get(itemKey)

		// Выдачи и возвраты по монтажникам — независимо от направления
		const technicianName = WAREHOUSE_ISSUE_ACTIONS.has(m.action)
			? m.target_user_name
			: WAREHOUSE_RETURN_ACTIONS.has(m.action)
				? m.from_user_name
				: null

		if (technicianName) {
			if (!technicians.has(technicianName)) {
				technicians.set(technicianName, {
					key: technicianName,
					name: technicianName,
					issued: emptyBucket(),
					returned: emptyBucket(),
					devices: [],
					consumables: new Map(),
				})
			}

			const entry = technicians.get(technicianName)

			if (WAREHOUSE_ISSUE_ACTIONS.has(m.action)) {
				addToBucket(entry.issued, kind, qty)
				pushDetail(entry.devices, entry.consumables, m, qty)
			} else {
				addToBucket(entry.returned, kind, qty)
			}
		}

		if (source != null && target != null && source !== target) {
			add(source, sourceName, 'out', reason, kind, qty, m)
			add(target, m.to_city_name, 'in', reason, kind, qty, m)

			addToBucket(totals.out, kind, qty)
			addToBucket(totals.in, kind, qty)
			addToBucket(totals.transfer, kind, qty)

			item.qty_in += qty
			item.qty_out += qty

			const routeKey = `${source}-${target}`

			if (!routes.has(routeKey)) {
				routes.set(routeKey, {
					key: routeKey,
					from_city_name: sourceName || `ID: ${source}`,
					to_city_name: m.to_city_name || `ID: ${target}`,
					...emptyBucket(),
				})
			}

			addToBucket(routes.get(routeKey), kind, qty)

			if (!transfers.has(routeKey)) {
				transfers.set(routeKey, {
					key: routeKey,
					from_city_name: sourceName || `ID: ${source}`,
					to_city_name: m.to_city_name || `ID: ${target}`,
					devices: [],
					consumables: new Map(),
				})
			}

			const transfer = transfers.get(routeKey)
			pushDetail(transfer.devices, transfer.consumables, m, qty)
		} else if (source != null && target != null) {
			add(source, sourceName, 'internal', reason, kind, qty, m)
			addToBucket(totals.internal, kind, qty)
		} else if (target != null) {
			add(target, m.to_city_name, 'in', reason, kind, qty, m)
			addToBucket(totals.in, kind, qty)
			item.qty_in += qty
		} else if (source != null) {
			add(source, sourceName, 'out', reason, kind, qty, m)
			addToBucket(totals.out, kind, qty)
			item.qty_out += qty
		}
	})

	const reasonsToList = (map) =>
		[...map.entries()]
			.map(([reason, values]) => ({
				reason,
				label: WAREHOUSE_REASON_LABELS[reason] || reason,
				devices: values.devices,
				consumables: values.consumables,
				total: values.total,
				deviceList: values.deviceList.sort(
					(a, b) => new Date(b.date) - new Date(a.date),
				),
				consumableList: [...values.consumableMap.values()].sort(
					(a, b) => b.qty - a.qty,
				),
			}))
			.filter((row) => row.total > 0)
			.sort((a, b) => b.total - a.total)

	const cityList = [...cities.values()]
		.map((entry) => ({
			...entry,
			in_reasons: reasonsToList(entry.in_reasons),
			out_reasons: reasonsToList(entry.out_reasons),
			internal_reasons: reasonsToList(entry.internal_reasons),
			net: {
				devices: entry.in.devices - entry.out.devices,
				consumables: entry.in.consumables - entry.out.consumables,
				total: entry.in.total - entry.out.total,
			},
		}))
		.filter(
			(entry) => entry.in.total + entry.out.total + entry.internal.total > 0,
		)
		.sort((a, b) => b.in.total + b.out.total - (a.in.total + a.out.total))

	const topItems = [...items.values()]
		.map((item) => ({ ...item, total: item.qty_in + item.qty_out }))
		.filter((item) => item.total > 0)
		.sort((a, b) => b.total - a.total)
		.slice(0, 12)

	const routeList = [...routes.values()].sort((a, b) => b.total - a.total)

	const transferList = routeList
		.map((route) => {
			const detail = transfers.get(route.key)

			return {
				key: route.key,
				from_city_name: route.from_city_name,
				to_city_name: route.to_city_name,

				// Счётчики и детализация лежат под разными именами: раньше
				// массивы затирали числа и в разметку попадал массив объектов.
				devicesCount: route.devices,
				consumablesCount: route.consumables,
				total: route.total,

				devices: (detail?.devices || []).sort(
					(a, b) => new Date(b.date) - new Date(a.date),
				),
				consumables: [...(detail?.consumables?.values() || [])].sort(
					(a, b) => b.qty - a.qty,
				),
			}
		})
		.filter((route) => route.devices.length > 0 || route.consumables.length > 0)

	const technicianList = [...technicians.values()]
		.map((entry) => ({
			...entry,
			devices: entry.devices.sort((a, b) => new Date(b.date) - new Date(a.date)),
			consumables: [...entry.consumables.values()].sort((a, b) => b.qty - a.qty),
		}))
		.filter((entry) => entry.issued.total + entry.returned.total > 0)
		.sort((a, b) => b.issued.total - a.issued.total)

	return {
		totals,
		cities: cityList,
		routes: routeList,
		transfers: transferList,
		technicians: technicianList,
		topItems,
		unknownActions: [...unknownActions],
	}
}

// Остатки на складе по городам — из /warehouse/items, один запрос.
const aggregateWarehouseStock = (items, cityId) => {
	const cityFilter = cityId ? Number(cityId) : null
	const cities = new Map()
	const totals = emptyBucket()

	items.forEach((item) => {
		const id = item.city_id != null ? Number(item.city_id) : null
		if (cityFilter != null && id !== cityFilter) return

		const key = id == null ? 'none' : String(id)

		if (!cities.has(key)) {
			cities.set(key, {
				key,
				city_id: id,
				city_name: item.city_name || 'Город не указан',
				devices: 0,
				consumables: 0,
				total: 0,
				categories: new Map(),
			})
		}

		const entry = cities.get(key)
		const kind = item.is_serialized ? 'devices' : 'consumables'
		const qty = item.is_serialized ? 1 : Number(item.quantity) || 0

		addToBucket(entry, kind, qty)
		addToBucket(totals, kind, qty)

		const category = item.category || 'OTHER'
		if (!entry.categories.has(category)) entry.categories.set(category, 0)
		entry.categories.set(category, entry.categories.get(category) + qty)
	})

	const cityList = [...cities.values()]
		.map((entry) => ({
			...entry,
			categories: [...entry.categories.entries()]
				.map(([category, count]) => ({
					category,
					label: WAREHOUSE_CATEGORIES[category] || category,
					count,
				}))
				.sort((a, b) => b.count - a.count),
		}))
		.sort((a, b) => b.total - a.total)

	return { totals, cities: cityList }
}

// Страховка: ошибка в одном блоке отчёта не должна ронять всю страницу
// в белый экран. Сбрасывается сменой key при смене фильтров.
class ReportsErrorBoundary extends React.Component {
	constructor(props) {
		super(props)
		this.state = { error: null }
	}

	static getDerivedStateFromError(error) {
		return { error }
	}

	componentDidCatch(error, info) {
		console.error('Ошибка отчёта:', error, info)
	}

	render() {
		if (this.state.error) {
			return (
				<div className='error-message'>
					Не удалось построить этот блок отчёта: {this.state.error.message}.
					Измените фильтры или обновите страницу.
				</div>
			)
		}

		return this.props.children
	}
}

// Содержимое отправки или выдачи: устройства перечислены поштучно с
// идентификатором, расходники — суммой по названию.
function WarehouseContents({ devices, consumables, onOpenRequest }) {
	if (devices.length === 0 && consumables.length === 0) {
		return <div className='reports-wh-detail-empty'>Нет позиций</div>
	}

	return (
		<div className='reports-wh-contents'>
			{devices.length > 0 && (
				<div className='reports-wh-contents-block'>
					<div className='reports-wh-detail-title is-in'>
						Устройства ({devices.length})
					</div>

					{devices.map((device) => (
						<div key={device.key} className='reports-wh-device'>
							<span className='reports-wh-device-name' title={device.name}>
								{device.name}
							</span>

							<span className='reports-wh-device-id'>
								{device.identifier || 'без идентификатора'}
							</span>

							<span className='reports-wh-device-meta'>
								{device.request_id ? (
									onOpenRequest ? (
										<button
											type='button'
											className='reports-request-chip is-clickable'
											onClick={() => onOpenRequest(device.request_id)}
											title='Открыть заявку'
										>
											№{device.request_id}
										</button>
									) : (
										<span className='reports-request-chip'>
											№{device.request_id}
										</span>
									)
								) : null}

								<span className='reports-wh-device-date'>
									{formatShortDate(device.date)}
								</span>
							</span>
						</div>
					))}
				</div>
			)}

			{consumables.length > 0 && (
				<div className='reports-wh-contents-block'>
					<div className='reports-wh-detail-title is-neutral'>
						Расходники ({consumables.length})
					</div>

					{consumables.map((row) => (
						<div key={row.key} className='reports-wh-detail-row'>
							<span className='reports-wh-detail-label' title={row.name}>
								{row.name}
								{row.request_ids?.size > 0 && (
									<span className='reports-wh-detail-requests'>
										{[...row.request_ids].slice(0, 6).map((id) =>
											onOpenRequest ? (
												<button
													key={id}
													type='button'
													className='reports-request-chip is-clickable'
													onClick={() => onOpenRequest(id)}
													title='Открыть заявку'
												>
													№{id}
												</button>
											) : (
												<span key={id} className='reports-request-chip'>
													№{id}
												</span>
											),
										)}
										{row.request_ids.size > 6 && (
											<span className='reports-wh-detail-more'>
												+{row.request_ids.size - 6}
											</span>
										)}
									</span>
								)}
							</span>
							<span className='reports-wh-detail-value'>{row.qty}</span>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

// Раскрывающийся список отправок и выдач: строка — маршрут или монтажник,
// внутри — что именно уехало или было выдано.
function WarehouseDetailList({ rows, emptyLabel, renderSummary, onOpenRequest }) {
	const [expandedKey, setExpandedKey] = useState(null)

	if (rows.length === 0) {
		return <div className='reports-empty'>{emptyLabel}</div>
	}

	return (
		<div className='reports-bar-list'>
			{rows.map((row) => {
				const isOpen = expandedKey === row.key

				return (
					<div key={row.key} className='reports-tech-row'>
						<button
							type='button'
							className={`reports-wh-detail-toggle ${isOpen ? 'is-open' : ''}`}
							onClick={() => setExpandedKey(isOpen ? null : row.key)}
							aria-expanded={isOpen}
						>
							<i className='fa-solid fa-chevron-right reports-tech-chevron'></i>
							{renderSummary(row)}
						</button>

						{isOpen && (
							<div className='reports-tech-clients'>
								<WarehouseContents
									devices={row.devices}
									consumables={row.consumables}
									onOpenRequest={onOpenRequest}
								/>
							</div>
						)}
					</div>
				)
			})}
		</div>
	)
}

function WarehouseReportView({
	stock,
	movements,
	onOpenRequest,
	itemsLoading,
	itemsError,
	movementsProgress,
	movementsError,
	movementsLoaded,
	onLoadMovements,
	onCancelMovements,
	cities,
	filters,
	onFilterChange,
	onReset,
	expandedCity,
	onToggleCity,
}) {
	const maxStock = Math.max(...stock.cities.map((c) => c.total), 1)
	const cityRows = movements?.cities || []
	const routes = movements?.routes || []
	const topItems = movements?.topItems || []

	const maxTurnover = Math.max(
		...cityRows.map((row) => row.in.total + row.out.total),
		1,
	)

	const maxRoute = Math.max(...routes.map((row) => row.total), 1)

	return (
		<>
			<div className='filters-bar'>
				<input
					type='date'
					className={
						filters.date_from ? 'filter-input filter-active' : 'filter-input'
					}
					name='date_from'
					value={filters.date_from}
					onChange={onFilterChange}
					title='Движения с'
				/>

				<input
					type='date'
					className={
						filters.date_to ? 'filter-input filter-active' : 'filter-input'
					}
					name='date_to'
					value={filters.date_to}
					onChange={onFilterChange}
					title='Движения по'
				/>

				<select
					className={
						filters.city_id ? 'filter-select filter-active' : 'filter-select'
					}
					name='city_id'
					value={filters.city_id}
					onChange={onFilterChange}
				>
					<option value=''>Все города</option>
					{cities.map((city) => (
						<option key={city.id} value={city.id}>
							{city.name}
						</option>
					))}
				</select>

				<button className='btn-reset' onClick={onReset}>
					Сбросить
				</button>
			</div>

			{itemsError && <div className='error-message'>{itemsError}</div>}

			{itemsLoading ? (
				<div>Загрузка...</div>
			) : (
				<>
					<div className='reports-summary-cards'>
						<div className='reports-summary-card reports-summary-card-main'>
							<div className='reports-summary-value'>{stock.totals.devices}</div>
							<div className='reports-summary-label'>Устройств на складе</div>
						</div>

						<div className='reports-summary-card'>
							<div className='reports-summary-value'>
								{stock.totals.consumables}
							</div>
							<div className='reports-summary-label'>Расходников на складе</div>
						</div>

						<div className='reports-summary-card'>
							<div className='reports-summary-value'>{stock.cities.length}</div>
							<div className='reports-summary-label'>Городов с остатками</div>
						</div>
					</div>

					<div className='reports-card'>
						<div className='reports-card-header'>
							<h3>Остатки по городам</h3>
							<span className='reports-card-header-note'>на текущий момент</span>
						</div>

						{stock.cities.length === 0 ? (
							<div className='reports-empty'>Позиций на складе нет</div>
						) : (
							<div className='reports-bar-list'>
								{stock.cities.map((city) => (
									<div key={city.key} className='reports-bar-row'>
										<span className='reports-bar-row-label' title={city.city_name}>
											{city.city_name}
										</span>

										<span className='reports-bar-row-track'>
											<span
												className='reports-bar-row-fill'
												style={{
													width: `${Math.max((city.total / maxStock) * 100, 4)}%`,
													background: '#5e9424',
												}}
											/>
										</span>

										<span
											className='reports-bar-row-count'
											title={`${city.devices} устройств, ${city.consumables} расходников`}
										>
											{city.total}
										</span>
									</div>
								))}
							</div>
						)}
					</div>

					<div className='reports-card'>
						<div className='reports-card-header'>
							<h3>Приход и расход по городам</h3>

							{movementsLoaded && !movementsProgress && (
								<button
									type='button'
									className='reports-card-link'
									onClick={onLoadMovements}
								>
									<i className='fa-solid fa-rotate'></i>Пересчитать
								</button>
							)}
						</div>

						{movementsError && (
							<div className='error-message'>{movementsError}</div>
						)}

						{movementsProgress ? (
							<div className='reports-wh-progress'>
								<div className='reports-wh-progress-track'>
									<span
										className='reports-wh-progress-fill'
										style={{
											width: `${
												(movementsProgress.done / movementsProgress.total) * 100
											}%`,
										}}
									/>
								</div>

								<div className='reports-wh-progress-meta'>
									<span>
										Обработано {movementsProgress.done} из{' '}
										{movementsProgress.total} позиций
									</span>

									<button
										type='button'
										className='reports-card-link'
										onClick={onCancelMovements}
									>
										Отменить
									</button>
								</div>
							</div>
						) : !movementsLoaded ? (
							<div className='reports-wh-cta'>
								<p>
									API отдаёт историю движений только по одной позиции за раз,
									поэтому приход и расход считаются обходом всех позиций склада —
									это занимает время. Даты и город после расчёта меняются без
									повторной загрузки.
								</p>

								<button
									type='button'
									className='reports-wh-cta-btn'
									onClick={onLoadMovements}
								>
									Посчитать приход и расход
								</button>
							</div>
						) : cityRows.length === 0 ? (
							<div className='reports-empty'>Движений за период нет</div>
						) : (
							<div className='reports-bar-list'>
								{cityRows.map((row) => {
									const isOpen = expandedCity === row.key

									return (
										<div key={row.key} className='reports-tech-row'>
											<button
												type='button'
												className={`reports-wh-city-row ${isOpen ? 'is-open' : ''}`}
												onClick={() => onToggleCity(isOpen ? null : row.key)}
												aria-expanded={isOpen}
											>
												<span className='reports-wh-city-name'>
													<i className='fa-solid fa-chevron-right reports-tech-chevron'></i>
													{row.city_name}
												</span>

												<span className='reports-wh-city-bar'>
													<span
														className='reports-wh-city-bar-in'
														style={{
															width: `${(row.in.total / maxTurnover) * 100}%`,
														}}
													/>
													<span
														className='reports-wh-city-bar-out'
														style={{
															width: `${(row.out.total / maxTurnover) * 100}%`,
														}}
													/>
												</span>

												<span className='reports-wh-city-metric is-in'>
													+{row.in.total}
												</span>

												<span className='reports-wh-city-metric is-out'>
													−{row.out.total}
												</span>

												<span
													className={`reports-wh-city-net ${
														row.net.total > 0
															? 'is-up'
															: row.net.total < 0
																? 'is-down'
																: ''
													}`}
												>
													{row.net.total > 0 ? '+' : ''}
													{row.net.total}
												</span>
											</button>

											{isOpen && (
												<div className='reports-tech-clients'>
													<div className='reports-wh-detail-grid'>
														<WarehouseReasonBlock
															title='Приход'
															rows={row.in_reasons}
															tone='in'
															onOpenRequest={onOpenRequest}
														/>
														<WarehouseReasonBlock
															title='Расход'
															rows={row.out_reasons}
															tone='out'
															onOpenRequest={onOpenRequest}
														/>
														<WarehouseReasonBlock
															title='Внутри города'
															rows={row.internal_reasons}
															tone='neutral'
															onOpenRequest={onOpenRequest}
														/>
													</div>
												</div>
											)}
										</div>
									)
								})}
							</div>
						)}
					</div>

					{movementsLoaded && !movementsProgress && (
						<>
							<div className='reports-grid-2'>
								<div className='reports-card'>
									<div className='reports-card-header'>
										<h3>Перевозки между городами</h3>
									</div>

									{routes.length === 0 ? (
										<div className='reports-empty'>Перевозок за период не было</div>
									) : (
										<div className='reports-bar-list'>
											{routes.map((route) => (
												<div key={route.key} className='reports-bar-row'>
													<span className='reports-bar-row-label'>
														{route.from_city_name} → {route.to_city_name}
													</span>

													<span className='reports-bar-row-track'>
														<span
															className='reports-bar-row-fill'
															style={{
																width: `${Math.max((route.total / maxRoute) * 100, 4)}%`,
																background: '#2f6fed',
															}}
														/>
													</span>

													<span
														className='reports-bar-row-count'
														title={`${route.devices} устройств, ${route.consumables} расходников`}
													>
														{route.total}
													</span>
												</div>
											))}
										</div>
									)}
								</div>

								<div className='reports-card'>
									<div className='reports-card-header'>
										<h3>Позиции с наибольшим оборотом</h3>
									</div>

									{topItems.length === 0 ? (
										<div className='reports-empty'>Движений за период нет</div>
									) : (
										<div className='reports-wh-items'>
											{topItems.map((item) => (
												<div key={item.key} className='reports-wh-item'>
													<span className='reports-wh-item-name' title={item.name}>
														{item.name}
														<span className='reports-wh-item-kind'>
															{item.is_serialized ? 'устройство' : 'расходник'}
														</span>
													</span>

													<span className='reports-wh-city-metric is-in'>
														+{item.qty_in}
													</span>

													<span className='reports-wh-city-metric is-out'>
														−{item.qty_out}
													</span>
												</div>
											))}
										</div>
									)}
								</div>
							</div>

							<div className='reports-card'>
								<div className='reports-card-header'>
									<h3>Что уехало в отправках</h3>
									<span className='reports-card-header-note'>
										клик — список IMEI и расходников
									</span>
								</div>

								<WarehouseDetailList
									rows={movements?.transfers || []}
									emptyLabel='Отправок за период не было'
									onOpenRequest={onOpenRequest}
									renderSummary={(row) => (
										<>
											<span className='reports-wh-summary-title'>
												{row.from_city_name} → {row.to_city_name}
											</span>

											<span className='reports-wh-summary-meta'>
												{row.devicesCount} устр. / {row.consumablesCount} расх.
											</span>
										</>
									)}
								/>
							</div>

							<div className='reports-card'>
								<div className='reports-card-header'>
									<h3>Выдано монтажникам</h3>
									<span className='reports-card-header-note'>
										клик — что именно получил монтажник
									</span>
								</div>

								<WarehouseDetailList
									rows={movements?.technicians || []}
									emptyLabel='Выдач за период не было'
									onOpenRequest={onOpenRequest}
									renderSummary={(row) => (
										<>
											<span className='reports-wh-summary-title'>{row.name}</span>

											<span className='reports-wh-summary-meta'>
												выдано {row.issued.devices} устр. /{' '}
												{row.issued.consumables} расх.
												{row.returned.total > 0
													? ` · возврат ${row.returned.total}`
													: ''}
											</span>
										</>
									)}
								/>
							</div>

							{movements?.unknownActions?.length > 0 && (
								<div className='reports-scope-note'>
									Встретились типы движений без описания — посчитаны как «Прочее»:{' '}
									{movements.unknownActions.join(', ')}
								</div>
							)}
						</>
					)}
				</>
			)}
		</>
	)
}

function WarehouseReasonBlock({ title, rows, tone, onOpenRequest }) {
	const [openReason, setOpenReason] = useState(null)

	return (
		<div className='reports-wh-detail'>
			<div className={`reports-wh-detail-title is-${tone}`}>{title}</div>

			{rows.length === 0 ? (
				<div className='reports-wh-detail-empty'>—</div>
			) : (
				rows.map((row) => {
					const hasDetail =
						row.deviceList?.length > 0 || row.consumableList?.length > 0
					const isOpen = openReason === row.reason && hasDetail

					return (
						<div key={row.reason}>
							<button
								type='button'
								className={`reports-wh-detail-row reports-wh-reason-btn ${
									isOpen ? 'is-open' : ''
								}`}
								onClick={() =>
									hasDetail && setOpenReason(isOpen ? null : row.reason)
								}
								disabled={!hasDetail}
							>
								<span className='reports-wh-detail-label'>
									{hasDetail && (
										<i className='fa-solid fa-chevron-right reports-tech-chevron'></i>
									)}
									{row.label}
								</span>

								<span className='reports-wh-detail-value'>
									{row.total}
									<span className='reports-wh-detail-split'>
										{row.devices} / {row.consumables}
									</span>
								</span>
							</button>

							{isOpen && (
								<div className='reports-wh-reason-detail'>
									<WarehouseContents
										devices={row.deviceList}
										consumables={row.consumableList}
										onOpenRequest={onOpenRequest}
									/>
								</div>
							)}
						</div>
					)
				})
			)}
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
	const navigate = useNavigate()
	const userRole = getUserRole()
	const userId = getUserId()

	// Те же роли, что видят пункт "Отчёты" в сайдбаре.
	const canViewRequestReports = [
		'ADMIN',
		'ROP',
		'MANAGER',
		'TECH_SUPPORT',
		'ACCOUNTANT',
	].includes(userRole)

	// Склад читают другие роли, поэтому право на вкладку отдельное.
	const canViewWarehouseReports = ['ADMIN', 'WAREHOUSE_MANAGER'].includes(
		userRole,
	)

	const canViewReports = canViewRequestReports || canViewWarehouseReports

	const [requests, setRequests] = useState([])
	const [cities, setCities] = useState([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')
	const [granularity, setGranularity] = useState('day')

	// Какое модальное окно открыто: 'clients' | 'technicians' | null
	const [openList, setOpenList] = useState(null)

	// Детализация до конкретных заявок: {title, note, requests}
	const [requestDetails, setRequestDetails] = useState(null)
	// Область для окна монтажников: только завершённые или все заявки
	const [technicianScope, setTechnicianScope] = useState('completed')

	// Личная статистика менеджера
	const [personalScope, setPersonalScope] = useState('all_mine')
	const [personalOnly, setPersonalOnly] = useState(false)

	// Режим отчёта: общий, по менеджерам или по складу
	const [reportMode, setReportMode] = useState(
		canViewRequestReports ? 'general' : 'warehouse',
	)
	const [selectedManagerId, setSelectedManagerId] = useState('')

	// Вкладка склада: свои фильтры и своя загрузка (данные считает бэкенд)
	const [warehouseFilters, setWarehouseFilters] = useState({
		date_from: '',
		date_to: '',
		city_id: '',
	})
	const [warehouseItems, setWarehouseItems] = useState([])
	const [warehouseLoading, setWarehouseLoading] = useState(false)
	const [warehouseError, setWarehouseError] = useState('')
	const [expandedWarehouseCity, setExpandedWarehouseCity] = useState(null)

	// Сырые движения, собранные обходом истории. Держим плоским списком,
	// чтобы смена дат и города пересчитывалась без повторной загрузки.
	const [warehouseMovements, setWarehouseMovements] = useState(null)
	const [movementsProgress, setMovementsProgress] = useState(null)
	const [movementsError, setMovementsError] = useState('')
	const movementsCancelRef = useRef(false)

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

		if (canViewRequestReports) {
			fetchRequests()
		} else {
			setLoading(false)
		}

		fetchCities()
	}, [canViewReports, canViewRequestReports])

	const isWarehouseMode = canViewWarehouseReports && reportMode === 'warehouse'

	// Позиции склада — один запрос, из них строятся остатки и список
	// идентификаторов для обхода истории.
	useEffect(() => {
		if (!isWarehouseMode || warehouseItems.length > 0) return

		let cancelled = false

		const fetchItems = async () => {
			setWarehouseLoading(true)
			setWarehouseError('')

			try {
				const res = await fetch(`${API_BASE_URL}/warehouse/items`, {
					headers: getAuthHeaders(),
				})

				if (!res.ok) throw new Error('Не удалось загрузить позиции склада')

				const data = await res.json()
				if (!cancelled) setWarehouseItems(Array.isArray(data) ? data : [])
			} catch (err) {
				if (!cancelled) setWarehouseError(err.message)
			} finally {
				if (!cancelled) setWarehouseLoading(false)
			}
		}

		fetchItems()

		return () => {
			cancelled = true
		}
	}, [isWarehouseMode, warehouseItems.length])

	// Обход истории по каждой позиции. Тяжёлая операция, поэтому запускается
	// только по кнопке и с ограничением параллельности.
	const loadWarehouseMovements = async () => {
		movementsCancelRef.current = false
		setMovementsError('')
		setMovementsProgress({ done: 0, total: warehouseItems.length })

		const collected = []

		await runWithConcurrency(
			warehouseItems,
			6,
			async (item) => {
				const res = await fetch(
					`${API_BASE_URL}/warehouse/items/${item.id}/history`,
					{ headers: getAuthHeaders() },
				)

				if (!res.ok) throw new Error(`История позиции ${item.id}`)

				const history = await res.json()

				;(Array.isArray(history) ? history : []).forEach((row) => {
					collected.push({
						action: row.action,
						created_at: row.created_at,
						quantity: row.quantity,
						from_city_id: row.from_city_id,
						from_city_name: row.from_city_name,
						to_city_id: row.to_city_id,
						to_city_name: row.to_city_name,
						target_user_name: row.target_user_name,
						from_user_name: row.from_user_name,
						request_id: row.request_id,
						is_serialized: Boolean(item.is_serialized),
						item_id: item.id,
						item_city_id: item.city_id,
						item_city_name: item.city_name,
						item_name: item.name,
						category: item.category,
						identifier_type: item.identifier_type,
						identifier_value: item.identifier_value,
						serial_number: item.serial_number,
					})
				})
			},
			(done, total) => setMovementsProgress({ done, total }),
			() => movementsCancelRef.current,
		)

		setMovementsProgress(null)

		if (movementsCancelRef.current) {
			setMovementsError('Расчёт отменён')
			return
		}

		setWarehouseMovements(collected)
	}

	const warehouseStock = useMemo(
		() => aggregateWarehouseStock(warehouseItems, warehouseFilters.city_id),
		[warehouseItems, warehouseFilters.city_id],
	)

	const warehouseMovementsReport = useMemo(() => {
		if (!warehouseMovements) return null

		return aggregateWarehouseMovements(warehouseMovements, {
			dateFrom: warehouseFilters.date_from,
			dateTo: warehouseFilters.date_to,
			cityId: warehouseFilters.city_id,
		})
	}, [warehouseMovements, warehouseFilters])


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
					requests: [],
					children: new Map(),
				})
			}

			const entry = map.get(key)
			entry.count += 1
			entry.requests.push(r)

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
					entry.children.set(row.key, { ...row, count: 0, requests: [] })
				}

				const child = entry.children.get(row.key)
				child.count += 1
				child.requests.push(r)
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

	const openRequestPage = (request) => {
		navigate(REQUESTS_ROUTE, {
			state: {
				[REQUEST_STATE_KEY]: request.id,
				// Меняющийся ключ, чтобы повторный переход на ту же заявку
				// тоже сработал — иначе state не изменится и эффект не сработает
				searchActionId: Date.now(),
			},
		})
	}

	// Провалиться в заявку из складского отчёта. Заявки грузятся отдельно,
	// поэтому если её нет в загруженном наборе — честно об этом говорим.
	const showRequestById = (requestId) => {
		const found = requests.filter((r) => Number(r.id) === Number(requestId))

		setRequestDetails({
			title: `Заявка №${requestId}`,
			note: found.length
				? null
				: 'Заявка не найдена среди загруженных — возможно, она вне области видимости вашей роли',
			requests: found,
		})
	}

	const showTechnicianRequests = (item, child) =>
		setRequestDetails({
			title: `Заявки: ${item.label}`,
			note: child
				? `Клиент: ${child.label}`
				: 'Все заявки монтажника за выбранный период',
			requests: child ? child.requests : item.requests,
		})

	const showClientRequests = (item, child) =>
		setRequestDetails({
			title: `Заявки: ${item.label}`,
			note: child
				? `Монтажник: ${child.label}`
				: 'Все заявки клиента за выбранный период',
			requests: child ? child.requests : item.requests,
		})

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
						{isWarehouseMode
							? 'Сколько устройств и расходников пришло и ушло по городам.'
							: 'Сколько заявок было, какие работы выполнены и у каких клиентов.'}
					</p>
				</div>

				{(canViewManagerReports || canViewWarehouseReports) && (
					<div className='reports-mode-switch'>
						<div className='reports-granularity-toggle'>
							{canViewRequestReports && (
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
							)}

							{canViewManagerReports && (
								<button
									type='button'
									className={`reports-granularity-btn ${
										reportMode === 'manager' ? 'active' : ''
									}`}
									onClick={() => setReportMode('manager')}
								>
									По менеджерам
								</button>
							)}

							{canViewWarehouseReports && (
								<button
									type='button'
									className={`reports-granularity-btn ${
										reportMode === 'warehouse' ? 'active' : ''
									}`}
									onClick={() => setReportMode('warehouse')}
								>
									Склад
								</button>
							)}
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

			{isWarehouseMode && (
				<ReportsErrorBoundary
					key={`wh-${warehouseFilters.date_from}-${warehouseFilters.date_to}-${warehouseFilters.city_id}`}
				>
				<WarehouseReportView
					stock={warehouseStock}
					onOpenRequest={
						canViewRequestReports && requests.length > 0
							? showRequestById
							: null
					}
					movements={warehouseMovementsReport}
					itemsLoading={warehouseLoading}
					itemsError={warehouseError}
					movementsProgress={movementsProgress}
					movementsError={movementsError}
					movementsLoaded={warehouseMovements !== null}
					onLoadMovements={loadWarehouseMovements}
					onCancelMovements={() => {
						movementsCancelRef.current = true
					}}
					cities={cities}
					filters={warehouseFilters}
					onFilterChange={(e) =>
						setWarehouseFilters((prev) => ({
							...prev,
							[e.target.name]: e.target.value,
						}))
					}
					onReset={() =>
						setWarehouseFilters({ date_from: '', date_to: '', city_id: '' })
					}
					expandedCity={expandedWarehouseCity}
					onToggleCity={setExpandedWarehouseCity}
				/>
				</ReportsErrorBoundary>
			)}

			{!isWarehouseMode && (
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
			)}

			{!isWarehouseMode && error && (
				<div className='error-message'>{error}</div>
			)}

			{!isWarehouseMode &&
				(loading ? (
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
								<div className='reports-card-title-group'>
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

									<h3>
										{isManagerView
											? 'Моя статистика'
											: `Отчёт менеджера: ${selectedManager?.name || ''}`}
									</h3>
								</div>

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
								onShowRequests={showClientRequests}
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
								onShowRequests={showTechnicianRequests}
							/>
						</div>
					</div>
				</>
			))}

			{requestDetails && (
				<RequestListModal
					title={requestDetails.title}
					note={requestDetails.note}
					requests={requestDetails.requests}
					onOpenRequest={openRequestPage}
					onClose={() => setRequestDetails(null)}
				/>
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
					onShowRequests={showClientRequests}
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
					onShowRequests={showTechnicianRequests}
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