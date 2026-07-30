import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL, getAuthHeaders } from '../api'
import '../styles/Requests.css'
import '../styles/Reports.css'

const getUserRole = () => {
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
		return JSON.parse(jsonPayload).role
	} catch (error) {
		return null
	}
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

const pad2 = n => String(n).padStart(2, '0')

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

const getClientDisplayName = req => {
	const clientType = req.client_type || req.type

	if (clientType === 'TOO' || clientType === 'IP') {
		return req.company_name || req.client_name || 'Без названия'
	}

	return req.client_name || req.company_name || 'Без названия'
}

const getRequestExecutors = req => {
	if (Array.isArray(req.executors) && req.executors.length > 0) {
		return req.executors.map(executor => ({
			id: executor.user_id,
			name: executor.user_name || `ID: ${executor.user_id}`,
		}))
	}

	if (req.assigned_to) {
		return [{ id: req.assigned_to, name: `ID: ${req.assigned_to}` }]
	}

	return []
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

export default function Reports() {
	const userRole = getUserRole()

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

	const [filters, setFilters] = useState({
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

	const handleFilterChange = e =>
		setFilters(prev => ({ ...prev, [e.target.name]: e.target.value }))

	const resetFilters = () =>
		setFilters({
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

	const filteredRequests = useMemo(() => {
		let result = requests

		if (filters.date_from) {
			const from = new Date(filters.date_from)
			from.setHours(0, 0, 0, 0)
			result = result.filter(r => new Date(r.created_at) >= from)
		}

		if (filters.date_to) {
			const to = new Date(filters.date_to)
			to.setHours(23, 59, 59, 999)
			result = result.filter(r => new Date(r.created_at) <= to)
		}

		if (filters.city) result = result.filter(r => r.city === filters.city)
		if (filters.work_type)
			result = result.filter(r => r.work_type === filters.work_type)
		if (filters.status)
			result = result.filter(r => r.status === filters.status)

		return result
	}, [requests, filters])

	const summary = useMemo(() => {
		const byStatus = { NEW: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0 }

		filteredRequests.forEach(r => {
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
		Object.keys(WORK_TYPE_META).forEach(key => {
			counts[key] = 0
		})

		filteredRequests
			.filter(r => r.status === 'COMPLETED')
			.forEach(r => {
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

		filteredRequests.forEach(r => {
			const key = getPeriodKey(r.created_at, granularity)
			if (!key) return
			buckets[key] = (buckets[key] || 0) + 1
		})

		return Object.keys(buckets)
			.sort()
			.map(key => ({
				key,
				count: buckets[key],
				label: formatPeriodLabel(key, granularity),
			}))
	}, [filteredRequests, granularity])

	const topClients = useMemo(() => {
		const map = new Map()

		filteredRequests.forEach(r => {
			const key = r.client_id ?? r.phone ?? getClientDisplayName(r)

			if (!map.has(key)) {
				map.set(key, { key, label: getClientDisplayName(r), count: 0 })
			}

			map.get(key).count += 1
		})

		return [...map.values()]
			.sort((a, b) => b.count - a.count)
			.slice(0, 8)
			.map(item => ({ ...item, color: '#5e9424' }))
	}, [filteredRequests])

	const topTechnicians = useMemo(() => {
		const map = new Map()

		filteredRequests
			.filter(r => r.status === 'COMPLETED')
			.forEach(r => {
				getRequestExecutors(r).forEach(executor => {
					if (executor.id == null) return

					if (!map.has(executor.id)) {
						map.set(executor.id, {
							key: executor.id,
							label: executor.name,
							count: 0,
						})
					}

					map.get(executor.id).count += 1
				})
			})

		return [...map.values()]
			.sort((a, b) => b.count - a.count)
			.slice(0, 8)
			.map(item => ({ ...item, color: '#2f6fed' }))
	}, [filteredRequests])

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
			</div>

			{userRole === 'MANAGER' && (
				<div className='reports-scope-note'>
					Отчёт построен по заявкам, доступным вашей роли: созданные вами и
					заявки клиентов, где вы ответственный менеджер — не по всей
					компании.
				</div>
			)}

			<div className='filters-bar'>
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

			{error && <div className='error-message'>{error}</div>}

			{loading ? (
				<div>Загрузка...</div>
			) : (
				<>
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
							</div>

							<BarList items={topClients} emptyLabel='Нет заявок за период' />
						</div>

						<div className='reports-card'>
							<div className='reports-card-header'>
								<h3>Монтажники и кол-во выполненных заявок</h3>
							</div>

							<BarList
								items={topTechnicians}
								emptyLabel='Нет завершённых заявок за период'
							/>
						</div>
					</div>
				</>
			)}
		</div>
	)
}