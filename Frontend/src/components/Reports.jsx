import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { API_BASE_URL, getAuthHeaders } from '../api'
import { getStoredUser } from '../utils/access'
import '../styles/Requests.css'
import '../styles/Reports.css'

const toNumber = value => {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : 0
}

const CURRENCY_SUFFIX = '\u20B8'

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
	maximumFractionDigits: 0,
})

const formatMoney = value =>
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

const ROLE_LABELS = {
	MANAGER: 'менеджер',
	ROP: 'РОП',
	ADMIN: 'админ',
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

const formatPeriodLabel = (key, granularity) => {
	if (granularity === 'month') {
		const [year, month] = key.split('-')
		return `${MONTH_NAMES[Number(month) - 1]} ${year}`
	}

	const [year, month, day] = key.split('-')
	const shortLabel = `${day}.${month}`

	return granularity === 'week' ? `с ${shortLabel}` : shortLabel
}

const getClientDisplayName = req => {
	const clientType = req.client_type || req.type

	if (clientType === 'TOO' || clientType === 'IP') {
		return req.company_name || req.client_name || 'Без названия'
	}

	return req.client_name || req.company_name || 'Без названия'
}

// Горизонтальный список с пропорциональными полосками — для разбивок
// по статусу, типу работ, топ-клиентам и топ-монтажникам.
function BarList({ items, emptyLabel = 'Нет данных за период' }) {
	if (items.length === 0) {
		return <div className='reports-empty'>{emptyLabel}</div>
	}

	const maxValue = Math.max(...items.map(item => item.count), 1)

	return (
		<div className='reports-bar-list'>
			{items.map(item => (
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
		const handleKeyDown = e => {
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
		? sorted.filter(r =>
				[
					String(r.id),
					getClientDisplayName(r),
					r.address,
					r.city,
					WORK_TYPE_META[r.work_type]?.label,
					STATUS_META[r.status]?.label,
				]
					.filter(Boolean)
					.some(field => String(field).toLowerCase().includes(normalizedQuery)),
			)
		: sorted

	return createPortal(
		<div
			className='reports-modal-backdrop'
			onMouseDown={e => {
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
						onChange={e => setQuery(e.target.value)}
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
							{filtered.map(r => {
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
												? e => {
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
												<span
													className='reports-request-address'
													title={r.address}
												>
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
	formatValue = value => value,
	onShowRequests = null,
}) {
	const [expandedKey, setExpandedKey] = useState(null)

	if (items.length === 0) {
		return <div className='reports-empty'>{emptyLabel}</div>
	}

	const maxValue = Math.max(...items.map(item => item.count), 1)

	return (
		<div className='reports-bar-list'>
			{items.map(item => {
				const itemKey = String(item.key)
				const children = item.children || []
				const hasChildren = children.length > 0
				const isOpen = hasChildren && expandedKey === itemKey
				const maxChildValue = Math.max(...children.map(child => child.count), 1)

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
								{children.map(child => {
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
												clickable
													? () => onShowRequests(item, child)
													: undefined
											}
											onKeyDown={
												clickable
													? e => {
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
	formatValue = value => value,
	toolbarExtra = null,
	onShowRequests = null,
	onClose,
}) {
	const [query, setQuery] = useState('')

	useEffect(() => {
		const handleKeyDown = e => {
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
		? items.filter(item => {
				if (String(item.label).toLowerCase().includes(normalizedQuery)) {
					return true
				}

				return (item.children || []).some(child =>
					String(child.label).toLowerCase().includes(normalizedQuery),
				)
			})
		: items

	const totalCount = items.reduce((sum, item) => sum + item.count, 0)

	return createPortal(
		<div
			className='reports-modal-backdrop'
			onMouseDown={e => {
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
						onChange={e => setQuery(e.target.value)}
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

	const maxValue = Math.max(...items.map(item => item.total), 1)

	return (
		<div className='reports-managers-list'>
			{items.map(item => (
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

const formatShortDate = value => {
	if (!value) return ''

	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return ''

	return date.toLocaleDateString('ru-RU', {
		day: '2-digit',
		month: '2-digit',
		year: '2-digit',
	})
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

					{devices.map(device => (
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

					{consumables.map(row => {
						const requestIds = Array.isArray(row.request_ids)
							? row.request_ids
							: []

						return (
							<div key={row.key} className='reports-wh-detail-row'>
								<span className='reports-wh-detail-label' title={row.name}>
									{row.name}
									{requestIds.length > 0 && (
										<span className='reports-wh-detail-requests'>
											{requestIds.slice(0, 6).map(id =>
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
											{requestIds.length > 6 && (
												<span className='reports-wh-detail-more'>
													+{requestIds.length - 6}
												</span>
											)}
										</span>
									)}
								</span>
								<span className='reports-wh-detail-value'>{row.qty}</span>
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
}

// Раскрывающийся список отправок и выдач: строка — маршрут или монтажник,
// внутри — что именно уехало или было выдано.
function WarehouseDetailList({
	rows,
	emptyLabel,
	renderSummary,
	onOpenRequest,
}) {
	const [expandedKey, setExpandedKey] = useState(null)

	if (rows.length === 0) {
		return <div className='reports-empty'>{emptyLabel}</div>
	}

	return (
		<div className='reports-bar-list'>
			{rows.map(row => {
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
	movementsLoaded,
	onLoadMovements,
	cities,
	filters,
	onFilterChange,
	onReset,
	expandedCity,
	onToggleCity,
}) {
	const maxStock = Math.max(...stock.cities.map(c => c.total), 1)
	const cityRows = movements?.cities || []
	const routes = movements?.routes || []
	const topItems = movements?.topItems || []

	const maxTurnover = Math.max(
		...cityRows.map(row => row.in.total + row.out.total),
		1,
	)

	const maxRoute = Math.max(...routes.map(row => row.total), 1)

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
					{cities.map(city => (
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
							<div className='reports-summary-value'>
								{stock.totals.devices}
							</div>
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
							<span className='reports-card-header-note'>
								на текущий момент
							</span>
						</div>

						{stock.cities.length === 0 ? (
							<div className='reports-empty'>Позиций на складе нет</div>
						) : (
							<div className='reports-bar-list'>
								{stock.cities.map(city => (
									<div key={city.key} className='reports-bar-row'>
										<span
											className='reports-bar-row-label'
											title={city.city_name}
										>
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

							{movementsLoaded && (
								<button
									type='button'
									className='reports-card-link'
									onClick={onLoadMovements}
								>
									<i className='fa-solid fa-rotate'></i>Пересчитать
								</button>
							)}
						</div>

						{!movementsLoaded ? (
							<div className='reports-wh-cta'>
								<p>
									Складской отчёт не загружен. Повторите запрос, чтобы получить
									остатки и движения за выбранный период.
								</p>

								<button
									type='button'
									className='reports-wh-cta-btn'
									onClick={onLoadMovements}
								>
									Повторить загрузку
								</button>
							</div>
						) : cityRows.length === 0 ? (
							<div className='reports-empty'>Движений за период нет</div>
						) : (
							<div className='reports-bar-list'>
								{cityRows.map(row => {
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

					{movementsLoaded && (
						<>
							<div className='reports-grid-2'>
								<div className='reports-card'>
									<div className='reports-card-header'>
										<h3>Перевозки между городами</h3>
									</div>

									{routes.length === 0 ? (
										<div className='reports-empty'>
											Перевозок за период не было
										</div>
									) : (
										<div className='reports-bar-list'>
											{routes.map(route => (
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
											{topItems.map(item => (
												<div key={item.key} className='reports-wh-item'>
													<span
														className='reports-wh-item-name'
														title={item.name}
													>
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
									renderSummary={row => (
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
									renderSummary={row => (
										<>
											<span className='reports-wh-summary-title'>
												{row.name}
											</span>

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
									Встретились типы движений без описания — посчитаны как
									«Прочее»: {movements.unknownActions.join(', ')}
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
				rows.map(row => {
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

	const maxCount = Math.max(...data.map(d => d.count), 1)
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
				{[0, 0.25, 0.5, 0.75, 1].map(fraction => (
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

// Поле поиска клиента с выпадающим списком совпадений. Варианты приходят
// вместе с готовым отчётом, отдельный запрос для них не нужен.
function ClientAutocomplete({ clients, value, onChange }) {
	const [query, setQuery] = useState('')
	const [isOpen, setIsOpen] = useState(false)
	const containerRef = useRef(null)

	useEffect(() => {
		if (!value) {
			setQuery('')
			return
		}

		const selected = clients.find(c => c.key === value)
		setQuery(selected ? selected.label : '')
	}, [value, clients])

	useEffect(() => {
		const handleClickOutside = e => {
			if (containerRef.current && !containerRef.current.contains(e.target)) {
				setIsOpen(false)
			}
		}

		document.addEventListener('click', handleClickOutside)
		return () => document.removeEventListener('click', handleClickOutside)
	}, [])

	const filtered = clients
		.filter(c => {
			const q = query.trim().toLowerCase()
			if (!q) return true

			return [c.label, c.phone]
				.filter(Boolean)
				.some(field => String(field).toLowerCase().includes(q))
		})
		.slice(0, 50)

	const handlePick = client => {
		onChange(client.key)
		setQuery(client.label)
		setIsOpen(false)
	}

	const handleInputChange = e => {
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
						filtered.map(client => (
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
	const storedUser = getStoredUser()
	const [access, setAccess] = useState(null)
	const [accessLoading, setAccessLoading] = useState(true)
	const userRole = access?.role ?? storedUser?.role ?? null
	const userId =
		access?.user_id != null
			? Number(access.user_id)
			: Number(storedUser?.id) || null
	const canViewRequestReports = Boolean(access?.can_view_request_reports)
	const canViewAllRequestReports = Boolean(access?.can_view_all_request_reports)
	const canViewWarehouseReports = Boolean(access?.can_view_warehouse_reports)
	const canViewManagerReports = Boolean(access?.can_view_manager_reports)
	const canViewReports = Boolean(access?.can_view_reports)

	const [requestReport, setRequestReport] = useState(null)
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
	const [reportMode, setReportMode] = useState('general')
	const [selectedManagerId, setSelectedManagerId] = useState('')

	// Вкладка склада: свои фильтры и своя загрузка (данные считает бэкенд)
	const [warehouseFilters, setWarehouseFilters] = useState({
		date_from: '',
		date_to: '',
		city_id: '',
	})
	const [warehouseReport, setWarehouseReport] = useState(null)
	const [warehouseLoading, setWarehouseLoading] = useState(false)
	const [warehouseError, setWarehouseError] = useState('')
	const [expandedWarehouseCity, setExpandedWarehouseCity] = useState(null)
	const [warehouseReloadKey, setWarehouseReloadKey] = useState(0)

	const [filters, setFilters] = useState({
		client_key: '',
		date_from: '',
		date_to: '',
		city: '',
		work_type: '',
		status: '',
	})

	const isWarehouseMode = canViewWarehouseReports && reportMode === 'warehouse'

	// Отчёт ограничен своими заявками — значит нужен личный блок.
	// Это ровно то условие, по которому бэкенд сужает выборку в get_request_rows().
	const isPersonalReport = canViewRequestReports && !canViewAllRequestReports
	const canSplitPersonal = isPersonalReport && userId != null
	const isManagerReportMode = canViewManagerReports && reportMode === 'manager'
	const isManagerView =
		isPersonalReport && !isManagerReportMode && userId != null
	const selectedManagerIdNum = selectedManagerId
		? Number(selectedManagerId)
		: null
	
	const personaId = isManagerView
		? userId
		: isManagerReportMode
			? selectedManagerIdNum
			: null

	// Сначала получаем права с backend. Роль из JWT оставлена только как
	// временный fallback до завершения запроса.
	useEffect(() => {
		const controller = new AbortController()

		const loadInitialData = async () => {
			try {
				const accessResponse = await fetch(`${API_BASE_URL}/reports/access`, {
					headers: getAuthHeaders(),
					signal: controller.signal,
				})

				if (!accessResponse.ok) {
					throw new Error('Не удалось проверить доступ к отчётам')
				}

				const accessData = await accessResponse.json()
				setAccess(accessData)

				const citiesResponse = await fetch(`${API_BASE_URL}/cities`, {
					headers: getAuthHeaders(),
					signal: controller.signal,
				})

				if (citiesResponse.ok) {
					const citiesData = await citiesResponse.json()
					setCities(Array.isArray(citiesData) ? citiesData : [])
				}
			} catch (err) {
				if (err.name !== 'AbortError') setError(err.message)
			} finally {
				if (!controller.signal.aborted) setAccessLoading(false)
			}
		}

		loadInitialData()

		return () => controller.abort()
	}, [])

	useEffect(() => {
		if (!access) return

		if (!access.can_view_request_reports && access.can_view_warehouse_reports) {
			setReportMode('warehouse')
		} else if (!access.can_view_manager_reports && reportMode === 'manager') {
			setReportMode('general')
		} else if (
			!access.can_view_warehouse_reports &&
			reportMode === 'warehouse'
		) {
			setReportMode('general')
		}
	}, [access, reportMode])

	// Backend возвращает уже отфильтрованные агрегаты и связанные заявки.
	useEffect(() => {
		if (!access || !canViewRequestReports) return

		const controller = new AbortController()

		const fetchReport = async () => {
			setLoading(true)
			setError('')

			try {
				const params = new URLSearchParams()

				Object.entries(filters).forEach(([key, value]) => {
					if (value) params.set(key, value)
				})

				params.set('granularity', granularity)
				params.set('personal_scope', personalScope)
				params.set('personal_only', String(personalOnly))

				if (isManagerReportMode && selectedManagerId) {
					params.set('manager_id', selectedManagerId)
				}

				const res = await fetch(
					`${API_BASE_URL}/reports/requests?${params.toString()}`,
					{
						headers: getAuthHeaders(),
						signal: controller.signal,
					},
				)

				if (!res.ok) {
					const payload = await res.json().catch(() => null)
					throw new Error(payload?.detail || 'Не удалось загрузить отчёт')
				}

				const data = await res.json()
				setRequestReport(data)
			} catch (err) {
				if (err.name !== 'AbortError') setError(err.message)
			} finally {
				if (!controller.signal.aborted) setLoading(false)
			}
		}

		fetchReport()

		return () => controller.abort()
	}, [
		access,
		canViewRequestReports,
		filters,
		granularity,
		personalScope,
		personalOnly,
		isManagerReportMode,
		selectedManagerId,
	])

	// Складской отчёт теперь загружается одним запросом — без обхода истории
	// каждой позиции из браузера.
	useEffect(() => {
		if (!access || !isWarehouseMode) return

		const controller = new AbortController()

		const fetchWarehouseReport = async () => {
			setWarehouseLoading(true)
			setWarehouseError('')
			setWarehouseReport(null)

			try {
				const params = new URLSearchParams()
				Object.entries(warehouseFilters).forEach(([key, value]) => {
					if (value) params.set(key, value)
				})

				const suffix = params.toString() ? `?${params.toString()}` : ''
				const res = await fetch(`${API_BASE_URL}/reports/warehouse${suffix}`, {
					headers: getAuthHeaders(),
					signal: controller.signal,
				})

				if (!res.ok) {
					const payload = await res.json().catch(() => null)
					throw new Error(
						payload?.detail || 'Не удалось загрузить складской отчёт',
					)
				}

				setWarehouseReport(await res.json())
			} catch (err) {
				if (err.name !== 'AbortError') setWarehouseError(err.message)
			} finally {
				if (!controller.signal.aborted) setWarehouseLoading(false)
			}
		}

		fetchWarehouseReport()
		return () => controller.abort()
	}, [access, isWarehouseMode, warehouseFilters, warehouseReloadKey])

	const loadWarehouseMovements = () => setWarehouseReloadKey(value => value + 1)

	const warehouseStock = warehouseReport?.stock || {
		totals: { devices: 0, consumables: 0, total: 0 },
		cities: [],
	}
	const warehouseMovementsReport = warehouseReport?.movements || null

	const handleFilterChange = e =>
		setFilters(prev => ({ ...prev, [e.target.name]: e.target.value }))

	const resetFilters = () =>
		setFilters({
			client_key: '',
			date_from: '',
			date_to: '',
			city: '',
			work_type: '',
			status: '',
		})

	const getFilterClassName = name =>
		filters[name] ? 'filter-input filter-active' : 'filter-input'

	const getFilterSelectClassName = name =>
		filters[name] ? 'filter-select filter-active' : 'filter-select'

	const clientOptions = requestReport?.client_options || []
	const statusCountMap = Object.fromEntries(
		(requestReport?.by_status || []).map(row => [row.key, row.count]),
	)
	const workTypeCountMap = Object.fromEntries(
		(requestReport?.by_work_type || []).map(row => [row.key, row.count]),
	)

	const summary = {
		total: requestReport?.summary?.total || 0,
		byStatus: statusCountMap,
	}

	const statusBars = Object.entries(STATUS_META).map(([key, meta]) => ({
		key,
		label: meta.label,
		color: meta.color,
		count: statusCountMap[key] || 0,
	}))

	const workTypeBars = Object.entries(WORK_TYPE_META).map(([key, meta]) => ({
		key,
		label: meta.label,
		color: meta.color,
		count: workTypeCountMap[key] || 0,
	}))

	const completedWorkTotal = workTypeBars.reduce(
		(sum, bar) => sum + bar.count,
		0,
	)

	const timeSeries = (requestReport?.timeline || []).map(row => ({
		key: row.key,
		count: row.total || 0,
		label: formatPeriodLabel(row.key, granularity),
	}))

	const comparison = requestReport?.period_comparison
	const periodComparison = comparison
		? {
				currentCount: comparison.current_count,
				previousCount: comparison.previous_count,
				deltaPercent: comparison.delta_percent,
			}
		: null

	const clientStats = (requestReport?.clients || []).map(row => ({
		...row,
		color: '#5e9424',
	}))
	const technicianStats = (requestReport?.technicians_completed || []).map(
		row => ({ ...row, color: '#2f6fed' }),
	)
	const technicianStatsAll = (requestReport?.technicians_all || []).map(
		row => ({ ...row, color: '#2f6fed' }),
	)
	const canViewPrices = Boolean(
		requestReport?.access?.can_view_money ?? access?.can_view_money,
	)
	const managerOptions = (requestReport?.manager_options || []).map(row => ({
		...row,
		id: Number(row.id),
	}))

	const selectedManager =
		managerOptions.find(manager => manager.id === selectedManagerIdNum) || null

	const managerLeaderboard = (requestReport?.managers || []).map(row => ({
		...row,
		id: Number(row.id),
		paidSum: toNumber(row.paid_sum),
	}))

	const personalData = requestReport?.personal
	const backendPersonalSummary = personalData?.summary
	const personalSummary = {
		total: backendPersonalSummary?.total || 0,
		clients: backendPersonalSummary?.clients || 0,
		completed: backendPersonalSummary?.completed || 0,
		inProgress: backendPersonalSummary?.in_progress || 0,
		paidSum: toNumber(backendPersonalSummary?.paid_sum),
		paidCount: backendPersonalSummary?.paid_count || 0,
		pendingSum: toNumber(backendPersonalSummary?.pending_sum),
		pendingCount: backendPersonalSummary?.pending_count || 0,
		averageCheck: toNumber(backendPersonalSummary?.average_check),
	}
	const personalClientRevenue = (personalData?.client_revenue || []).map(
		row => ({ ...row, color: '#2e7d32' }),
	)

	const openRequestPage = request => {
		navigate(REQUESTS_ROUTE, {
			state: {
				[REQUEST_STATE_KEY]: request.id,
				// Меняющийся ключ, чтобы повторный переход на ту же заявку
				// тоже сработал — иначе state не изменится и эффект не сработает
				searchActionId: Date.now(),
			},
		})
	}

	// Из складского отчёта сразу открываем заявку: текущие фильтры отчёта
	// больше не должны мешать переходу по номеру заявки.
	const showRequestById = requestId =>
		openRequestPage({ id: Number(requestId) })

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

	if (accessLoading) {
		return <div className='requests-page-container'>Загрузка...</div>
	}

	if (!access) {
		return (
			<div className='requests-page-container'>
				<div className='error-message'>
					{error || 'Не удалось загрузить права доступа'}
				</div>
			</div>
		)
	}

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
								onChange={e => setSelectedManagerId(e.target.value)}
							>
								<option value=''>Все менеджеры (список)</option>
								{managerOptions.map(manager => (
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

			{isPersonalReport && (
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
						onOpenRequest={canViewRequestReports ? showRequestById : null}
						movements={warehouseMovementsReport}
						itemsLoading={warehouseLoading}
						itemsError={warehouseError}
						movementsLoaded={warehouseReport !== null}
						onLoadMovements={loadWarehouseMovements}
						cities={cities}
						filters={warehouseFilters}
						onFilterChange={e =>
							setWarehouseFilters(prev => ({
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
							onChange={value =>
								setFilters(prev => ({ ...prev, client_key: value }))
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
							{cities.map(city => (
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
										{PERSONAL_SCOPE_OPTIONS.map(option => (
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
									onSelect={id => setSelectedManagerId(String(id))}
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
											{PERSONAL_SCOPE_OPTIONS.map(option => (
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
												{isManagerView ? 'Мои клиенты' : 'Клиенты'} по
												оплаченной выручке
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
											onChange={e => setPersonalOnly(e.target.checked)}
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

							{statusBars.map(bar => (
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
									{GRANULARITY_OPTIONS.map(option => (
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
										{granularity === 'month'
											? 'в этом месяце'
											: 'на этой неделе'}
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
