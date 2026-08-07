import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { API_BASE_URL, getAuthHeaders } from '../api'
import RequestDetailModal from './RequestDetailModal'
import { getWorkTypeLabel } from '../utils/workTypes'
import '../styles/Calendar.css'

const START_HOUR = 8
const END_HOUR = 23
const SLOT_HEIGHT = 48
const GROUP_WINDOW_MINUTES = 30
const MAX_GROUP_WINDOW_MINUTES = 120
const DAY_COUNT = 7

const MS_IN_DAY = 24 * 60 * 60 * 1000

const monthNames = [
	'Январь',
	'Февраль',
	'Март',
	'Апрель',
	'Май',
	'Июнь',
	'Июль',
	'Август',
	'Сентябрь',
	'Октябрь',
	'Ноябрь',
	'Декабрь',
]

const weekdayNames = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

const workTypeOptions = [
	{ value: 'ALL', label: 'Все типы' },
	{ value: 'INSTALLATION', label: 'Установка' },
	{ value: 'DIAGNOSTIC', label: 'Диагностика' },
	{ value: 'REMOVAL', label: 'Снятие' },
	{ value: 'REFLASHING', label: 'Перепрошивка' },
]

const statusLabels = {
	NEW: 'В ожидании',
	IN_PROGRESS: 'В работе',
	COMPLETED: 'Завершено',
	CANCELLED: 'Отменено',
}

const getStartOfDay = date => {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

const getWeekStart = date => {
	const day = date.getDay()
	const diffToMonday = day === 0 ? -6 : 1 - day

	const weekStart = getStartOfDay(date)
	weekStart.setDate(weekStart.getDate() + diffToMonday)

	return weekStart
}

const addDays = (date, days) => {
	const next = new Date(date)
	next.setDate(next.getDate() + days)
	return next
}

const formatDateParam = date => {
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, '0')
	const day = String(date.getDate()).padStart(2, '0')

	return `${year}-${month}-${day}`
}

const formatTime = dateValue => {
	if (!dateValue) return '—'

	const date = new Date(dateValue)

	return date.toLocaleTimeString('ru-RU', {
		hour: '2-digit',
		minute: '2-digit',
	})
}

const formatDayMonth = date => {
	return date.toLocaleDateString('ru-RU', {
		day: 'numeric',
		month: 'short',
	})
}

const isSameDay = (a, b) => {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	)
}

const getEventDayIndex = (dateValue, weekStart) => {
	const date = getStartOfDay(new Date(dateValue))
	const start = getStartOfDay(weekStart)

	return Math.floor((date.getTime() - start.getTime()) / MS_IN_DAY)
}

const getMinutesFromDayStart = dateValue => {
	const date = new Date(dateValue)

	return date.getHours() * 60 + date.getMinutes()
}

const getEventStyle = item => {
	const startMinutes = getMinutesFromDayStart(item.scheduled_at)
	const duration = Number(item.scheduled_duration_minutes || 60)

	const viewStartMinutes = START_HOUR * 60
	const viewEndMinutes = END_HOUR * 60
	const totalViewMinutes = viewEndMinutes - viewStartMinutes

	const eventStart = Math.max(startMinutes, viewStartMinutes)
	const eventEnd = Math.min(startMinutes + duration, viewEndMinutes)

	const topMinutes = Math.max(eventStart - viewStartMinutes, 0)
	const heightMinutes = Math.max(eventEnd - eventStart, 30)

	const pxPerMinute = SLOT_HEIGHT / 60

	return {
		top: `${topMinutes * pxPerMinute}px`,
		height: `${Math.min(heightMinutes * pxPerMinute, totalViewMinutes * pxPerMinute)}px`,
	}
}

const getCurrentTimeStyle = weekStart => {
	const now = new Date()
	const dayIndex = getEventDayIndex(now, weekStart)

	if (dayIndex < 0 || dayIndex >= DAY_COUNT) {
		return null
	}

	const currentMinutes = getMinutesFromDayStart(now)
	const viewStartMinutes = START_HOUR * 60
	const viewEndMinutes = END_HOUR * 60

	if (currentMinutes < viewStartMinutes || currentMinutes > viewEndMinutes) {
		return null
	}

	const pxPerMinute = SLOT_HEIGHT / 60
	const top = (currentMinutes - viewStartMinutes) * pxPerMinute

	return {
		dayIndex,
		top,
	}
}

const buildEventTitle = item => {
	if (item.vehicles_summary) {
		return item.vehicles_summary
	}

	if (item.company_name) {
		return item.company_name
	}

	if (item.client_name) {
		return item.client_name
	}

	return `Заявка #${item.id}`
}

const buildClientLabel = item => {
	return (
		item.company_name ||
		item.client_name ||
		(item.client_id ? `Клиент #${item.client_id}` : 'Клиент не указан')
	)
}

const getRequestWord = count => {
	const lastDigit = count % 10
	const lastTwoDigits = count % 100

	if (lastDigit === 1 && lastTwoDigits !== 11) return 'заявка'

	if ([2, 3, 4].includes(lastDigit) && ![12, 13, 14].includes(lastTwoDigits)) {
		return 'заявки'
	}

	return 'заявок'
}

const getEventDurationMinutes = item => {
	return Math.max(Number(item?.scheduled_duration_minutes || 60), 30)
}

const getEventEndMinutesFromDayStart = item => {
	return (
		getMinutesFromDayStart(item.scheduled_at) + getEventDurationMinutes(item)
	)
}

const buildCalendarEventGroups = dayItems => {
	const groups = []

	;(dayItems || []).forEach(item => {
		const startMinutes = getMinutesFromDayStart(item.scheduled_at)
		const endMinutes = getEventEndMinutesFromDayStart(item)

		const lastGroup = groups[groups.length - 1]

		const shouldStartNewGroup =
			!lastGroup ||
			startMinutes >= lastGroup.endMinutes ||
			startMinutes - lastGroup.startMinutes >= MAX_GROUP_WINDOW_MINUTES

		if (shouldStartNewGroup) {
			groups.push({
				id: String(item.id),
				items: [item],
				startMinutes,
				lastStartMinutes: startMinutes,
				endMinutes: Math.max(endMinutes, startMinutes + 30),
			})

			return
		}

		const maxGroupEndMinutes = lastGroup.startMinutes + MAX_GROUP_WINDOW_MINUTES

		lastGroup.items.push(item)
		lastGroup.id = `${lastGroup.id}-${item.id}`
		lastGroup.lastStartMinutes = startMinutes
		lastGroup.endMinutes = Math.min(
			Math.max(lastGroup.endMinutes, endMinutes),
			maxGroupEndMinutes,
		)
	})

	return groups.map(group => ({
		...group,
		isGroup: group.items.length > 1,
	}))
}

const getGroupStyle = group => {
	const firstItem = group?.items?.[0]

	if (!firstItem) return {}

	const durationMinutes = Math.max(group.endMinutes - group.startMinutes, 30)

	return getEventStyle({
		...firstItem,
		scheduled_duration_minutes: durationMinutes,
	})
}

const getGroupTimeRange = group => {
	const firstItem = group?.items?.[0]

	if (!firstItem) return ''

	const startDate = new Date(firstItem.scheduled_at)
	const endDate = new Date(startDate)

	endDate.setHours(0, 0, 0, 0)
	endDate.setMinutes(group.endMinutes)

	return `${formatTime(startDate)} — ${formatTime(endDate)}`
}

export default function Calendar() {
	const location = useLocation()

	const [anchorDate, setAnchorDate] = useState(new Date())
	const [items, setItems] = useState([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')
	const [selectedRequestId, setSelectedRequestId] = useState(null)

	const [pendingHighlightRequestId, setPendingHighlightRequestId] =
		useState(null)
	const [highlightedRequestId, setHighlightedRequestId] = useState(null)
	const [highlightedGroupId, setHighlightedGroupId] = useState(null)
	const [forceOpenGroupId, setForceOpenGroupId] = useState(null)

	const groupRefs = useRef({})
	const singleEventRefs = useRef({})
	const highlightTimerRef = useRef(null)

	const userData = useMemo(() => {
		try {
			return JSON.parse(localStorage.getItem('user_data') || '{}')
		} catch {
			return {}
		}
	}, [])

	const userRole = String(userData?.role || '').toUpperCase()
	const isTechnician = userRole === 'TECHNICIAN'

	const [workTypeFilter, setWorkTypeFilter] = useState('ALL')

	const [citySearch, setCitySearch] = useState('')
	const [selectedCity, setSelectedCity] = useState('')
	const [isCityPickerOpen, setIsCityPickerOpen] = useState(false)

	const [clientSearch, setClientSearch] = useState('')
	const [selectedClientId, setSelectedClientId] = useState('')
	const [isClientPickerOpen, setIsClientPickerOpen] = useState(false)

	const weekStart = useMemo(() => getWeekStart(anchorDate), [anchorDate])
	const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart])

	const weekDays = useMemo(() => {
		return Array.from({ length: DAY_COUNT }, (_, index) =>
			addDays(weekStart, index),
		)
	}, [weekStart])

	const hours = useMemo(() => {
		return Array.from(
			{ length: END_HOUR - START_HOUR + 1 },
			(_, index) => START_HOUR + index,
		)
	}, [])

	const cityOptions = useMemo(() => {
		const cityMap = new Map()

		items.forEach(item => {
			const city = String(item.city || '').trim()

			if (!city) return

			cityMap.set(city.toLowerCase(), city)
		})

		return Array.from(cityMap.values()).sort((a, b) => a.localeCompare(b, 'ru'))
	}, [items])

	const visibleCityOptions = useMemo(() => {
		const query = citySearch.trim().toLowerCase()

		if (!query) return cityOptions.slice(0, 8)

		return cityOptions
			.filter(city => city.toLowerCase().includes(query))
			.slice(0, 8)
	}, [cityOptions, citySearch])

	const clientOptions = useMemo(() => {
		const clientMap = new Map()

		items.forEach(item => {
			const label = buildClientLabel(item).trim()
			const key = item.client_id ? String(item.client_id) : label.toLowerCase()

			if (!label) return

			if (!clientMap.has(key)) {
				clientMap.set(key, {
					id: item.client_id ? String(item.client_id) : '',
					key,
					label,
					meta:
						item.company_name && item.client_name
							? item.client_name
							: item.city || '',
				})
			}
		})

		return Array.from(clientMap.values()).sort((a, b) =>
			a.label.localeCompare(b.label, 'ru'),
		)
	}, [items])

	const visibleClientOptions = useMemo(() => {
		const query = clientSearch.trim().toLowerCase()

		if (!query) return clientOptions.slice(0, 8)

		return clientOptions
			.filter(client => {
				return (
					client.label.toLowerCase().includes(query) ||
					String(client.meta || '')
						.toLowerCase()
						.includes(query)
				)
			})
			.slice(0, 8)
	}, [clientOptions, clientSearch])

	const filteredItems = useMemo(() => {
		const cityQuery = citySearch.trim().toLowerCase()
		const clientQuery = clientSearch.trim().toLowerCase()

		return items.filter(item => {
			if (workTypeFilter !== 'ALL' && item.work_type !== workTypeFilter) {
				return false
			}

			if (!isTechnician) {
				const itemCity = String(item.city || '').trim()

				if (selectedCity) {
					if (itemCity !== selectedCity) return false
				} else if (cityQuery) {
					if (!itemCity.toLowerCase().includes(cityQuery)) return false
				}
			}

			const itemClientLabel = buildClientLabel(item)

			if (selectedClientId) {
				if (String(item.client_id || '') !== String(selectedClientId)) {
					return false
				}
			} else if (clientQuery) {
				if (!itemClientLabel.toLowerCase().includes(clientQuery)) {
					return false
				}
			}

			return true
		})
	}, [
		items,
		workTypeFilter,
		citySearch,
		selectedCity,
		clientSearch,
		selectedClientId,
		isTechnician,
	])

	const hasActiveFilters =
		workTypeFilter !== 'ALL' ||
		(!isTechnician && (Boolean(citySearch.trim()) || Boolean(selectedCity))) ||
		Boolean(clientSearch.trim()) ||
		Boolean(selectedClientId)

	const eventsByDay = useMemo(() => {
		const grouped = Array.from({ length: DAY_COUNT }, () => [])

		filteredItems.forEach(item => {
			if (!item.scheduled_at) return

			const dayIndex = getEventDayIndex(item.scheduled_at, weekStart)

			if (dayIndex < 0 || dayIndex >= DAY_COUNT) return

			grouped[dayIndex].push(item)
		})

		grouped.forEach(dayItems => {
			dayItems.sort((a, b) => {
				return new Date(a.scheduled_at) - new Date(b.scheduled_at)
			})
		})

		return grouped
	}, [filteredItems, weekStart])

	const eventGroupsByDay = useMemo(() => {
		return eventsByDay.map(dayItems => buildCalendarEventGroups(dayItems))
	}, [eventsByDay])

	useEffect(() => {
		const highlightRequestId = location.state?.highlightRequestId
		const highlightScheduledAt = location.state?.highlightScheduledAt

		if (!highlightRequestId) return

		const numericRequestId = Number(highlightRequestId)

		setPendingHighlightRequestId(numericRequestId)
		setHighlightedRequestId(numericRequestId)
		setHighlightedGroupId(null)
		setForceOpenGroupId(null)

		setWorkTypeFilter('ALL')
		setCitySearch('')
		setSelectedCity('')
		setClientSearch('')
		setSelectedClientId('')
		setIsCityPickerOpen(false)
		setIsClientPickerOpen(false)

		if (highlightScheduledAt) {
			const targetDate = new Date(highlightScheduledAt)

			if (!Number.isNaN(targetDate.getTime())) {
				setAnchorDate(targetDate)
			}
		}
	}, [location.state?.searchActionId])

	useEffect(() => {
		if (!pendingHighlightRequestId || loading) return

		const targetRequestId = Number(pendingHighlightRequestId)

		let targetGroup = null
		let targetSingleItem = null

		for (const dayGroups of eventGroupsByDay) {
			const foundGroup = dayGroups.find(group =>
				group.items.some(item => Number(item.id) === targetRequestId),
			)

			if (!foundGroup) continue

			if (foundGroup.isGroup) {
				targetGroup = foundGroup
			} else {
				targetSingleItem = foundGroup.items[0]
			}

			break
		}

		if (!targetGroup && !targetSingleItem) return

		if (highlightTimerRef.current) {
			clearTimeout(highlightTimerRef.current)
		}

		if (targetGroup) {
			setHighlightedGroupId(targetGroup.id)
			setForceOpenGroupId(targetGroup.id)
			setHighlightedRequestId(targetRequestId)
			setPendingHighlightRequestId(null)

			requestAnimationFrame(() => {
				groupRefs.current[targetGroup.id]?.scrollIntoView({
					behavior: 'smooth',
					block: 'center',
					inline: 'center',
				})
			})

			highlightTimerRef.current = setTimeout(() => {
				setForceOpenGroupId(null)
				setHighlightedGroupId(null)
				setHighlightedRequestId(null)
			}, 10000)

			return
		}

		if (targetSingleItem) {
			setHighlightedRequestId(targetRequestId)
			setPendingHighlightRequestId(null)

			requestAnimationFrame(() => {
				singleEventRefs.current[targetRequestId]?.scrollIntoView({
					behavior: 'smooth',
					block: 'center',
					inline: 'center',
				})
			})

			highlightTimerRef.current = setTimeout(() => {
				setHighlightedRequestId(null)
			}, 10000)
		}
	}, [eventGroupsByDay, pendingHighlightRequestId, loading])

	useEffect(() => {
		return () => {
			if (highlightTimerRef.current) {
				clearTimeout(highlightTimerRef.current)
			}
		}
	}, [])

	const currentTime = getCurrentTimeStyle(weekStart)

	const weekTitle = `${formatDayMonth(weekStart)} — ${formatDayMonth(
		addDays(weekStart, 6),
	)}`

	const monthTitle = `${monthNames[anchorDate.getMonth()]} ${anchorDate.getFullYear()}`

	const fetchCalendar = async () => {
		setLoading(true)
		setError('')

		try {
			const params = new URLSearchParams({
				date_from: formatDateParam(weekStart),
				date_to: formatDateParam(weekEnd),
			})

			const res = await fetch(`${API_BASE_URL}/requests/calendar?${params}`, {
				headers: getAuthHeaders(),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось загрузить календарь')
			}

			setItems(Array.isArray(data?.items) ? data.items : [])
		} catch (err) {
			setError(err.message)
			setItems([])
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchCalendar()
	}, [weekStart.getTime()])

	const goToday = () => {
		setAnchorDate(new Date())
	}

	const goPrevWeek = () => {
		setAnchorDate(prev => addDays(prev, -7))
	}

	const goNextWeek = () => {
		setAnchorDate(prev => addDays(prev, 7))
	}

	const clearCalendarFilters = () => {
		setWorkTypeFilter('ALL')
		setCitySearch('')
		setSelectedCity('')
		setClientSearch('')
		setSelectedClientId('')
		setIsCityPickerOpen(false)
		setIsClientPickerOpen(false)
	}

	const handleCityInputChange = e => {
		setCitySearch(e.target.value)
		setSelectedCity('')
		setIsCityPickerOpen(true)
	}

	const handleClientInputChange = e => {
		setClientSearch(e.target.value)
		setSelectedClientId('')
		setIsClientPickerOpen(true)
	}

	const selectCity = city => {
		setSelectedCity(city)
		setCitySearch(city)
		setIsCityPickerOpen(false)
	}

	const selectClient = client => {
		setSelectedClientId(client.id)
		setClientSearch(client.label)
		setIsClientPickerOpen(false)
	}

	const handleEventClick = item => {
		if (!item.can_open_details) {
			alert('Открыть детали можно только своих заявок')
			return
		}

		setSelectedRequestId(item.id)
	}

	const handleModalUpdated = () => {
		fetchCalendar()
	}

	const renderSingleEvent = item => {
		return (
			<button
				key={`event-${item.id}`}
				type='button'
				ref={element => {
					if (element) {
						singleEventRefs.current[item.id] = element
					}
				}}
				className={`crm-calendar-event ${String(
					item.work_type || '',
				).toLowerCase()} ${String(item.status || '').toLowerCase()} ${
					item.can_open_details ? 'can-open' : 'locked'
				} ${
					Number(item.id) === Number(highlightedRequestId)
						? 'notification-highlight'
						: ''
				}`}
				style={getEventStyle(item)}
				onClick={() => handleEventClick(item)}
				title={
					item.can_open_details ? 'Открыть заявку' : 'Нет доступа к деталям'
				}
			>
				<div className='crm-calendar-event-top'>
					<span className='crm-calendar-event-time'>
						{formatTime(item.scheduled_at)} —{' '}
						{formatTime(item.scheduled_end_at)}
					</span>

					{item.status === 'COMPLETED' && (
						<span className='crm-calendar-event-completed-badge'>
							✓ Завершена
						</span>
					)}
				</div>

				<div className='crm-calendar-event-title'>{buildEventTitle(item)}</div>

				<div className='crm-calendar-event-meta'>
					{getWorkTypeLabel(item.work_type)}
					{item.city ? ` · ${item.city}` : ''}
				</div>

				{item.executors_summary && (
					<div className='crm-calendar-event-executor'>
						{item.executors_summary}
					</div>
				)}

				{!item.can_open_details && (
					<div className='crm-calendar-event-lock'>Без доступа к деталям</div>
				)}

				{item.status && item.status !== 'COMPLETED' && (
					<div className='crm-calendar-event-status'>
						{statusLabels[item.status] || item.status}
					</div>
				)}
			</button>
		)
	}

	const renderEventGroup = (group, dayIndex) => {
		const firstItem = group.items[0]
		const openLeft = dayIndex >= 5

		return (
			<div
				key={`group-${group.id}`}
				ref={element => {
					if (element) {
						groupRefs.current[group.id] = element
					}
				}}
				className={`crm-calendar-event-group ${String(
					firstItem?.work_type || '',
				).toLowerCase()} ${openLeft ? 'open-left' : ''} ${
					forceOpenGroupId === group.id ? 'force-open' : ''
				} ${highlightedGroupId === group.id ? 'notification-highlight' : ''}`}
				style={getGroupStyle(group)}
				tabIndex={0}
			>
				<div className='crm-calendar-event-group-top'>
					<span>{getGroupTimeRange(group)}</span>
					<strong>
						{group.items.length} {getRequestWord(group.items.length)}
					</strong>
				</div>

				<div className='crm-calendar-event-group-title'>
					Заявки рядом по времени
				</div>

				<div className='crm-calendar-event-group-hint'>
					Наведите для деталей
				</div>

				<div
					className={`crm-calendar-event-group-menu ${
						highlightedGroupId === group.id ? 'notification-highlight-menu' : ''
					}`}
				>
					<div className='crm-calendar-event-group-menu-title'>
						Заявки рядом по времени
					</div>

					{group.items.map(item => (
						<button
							key={item.id}
							type='button'
							ref={element => {
								if (element) {
									singleEventRefs.current[item.id] = element
								}
							}}
							className={`crm-calendar-group-menu-item ${String(
								item.work_type || '',
							).toLowerCase()} ${String(item.status || '').toLowerCase()} ${
								item.can_open_details ? 'can-open' : 'locked'
							} ${
								Number(item.id) === Number(highlightedRequestId)
									? 'notification-highlight-item'
									: ''
							}`}
							onClick={() => handleEventClick(item)}
						>
							<div className='crm-calendar-group-menu-item-time'>
								{formatTime(item.scheduled_at)} —{' '}
								{formatTime(item.scheduled_end_at)}
							</div>

							<div className='crm-calendar-group-menu-item-title'>
								{buildEventTitle(item)}
							</div>

							<div className='crm-calendar-group-menu-item-meta'>
								{getWorkTypeLabel(item.work_type)}
								{item.city ? ` · ${item.city}` : ''}
								{item.executors_summary ? ` · ${item.executors_summary}` : ''}
							</div>

							{item.status === 'COMPLETED' && (
								<div className='crm-calendar-group-menu-completed'>
									✓ Завершена
								</div>
							)}

							{!item.can_open_details && (
								<div className='crm-calendar-group-menu-locked'>
									Без доступа к деталям
								</div>
							)}
						</button>
					))}
				</div>
			</div>
		)
	}

	return (
		<div className='crm-calendar-page'>
			<div className='crm-calendar-toolbar'>
				<div className='crm-calendar-toolbar-left'>
					<div className='crm-calendar-title-block'>
						<h1>Календарь</h1>
						<span>{weekTitle}</span>
					</div>

					<button
						type='button'
						className='crm-calendar-today-btn'
						onClick={goToday}
					>
						Сегодня
					</button>

					<div className='crm-calendar-nav'>
						<button
							type='button'
							onClick={goPrevWeek}
							title='Предыдущая неделя'
						>
							‹
						</button>
						<button type='button' onClick={goNextWeek} title='Следующая неделя'>
							›
						</button>
					</div>

					<div className='crm-calendar-month-title'>{monthTitle}</div>

					<div className='crm-calendar-filters'>
						<div className='crm-calendar-filter-field small'>
							<label>Тип работ</label>
							<select
								value={workTypeFilter}
								onChange={e => setWorkTypeFilter(e.target.value)}
							>
								{workTypeOptions.map(option => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</div>

						{!isTechnician && (
							<div className='crm-calendar-filter-field picker'>
								<label>Город</label>
								<input
									type='text'
									value={citySearch}
									placeholder='Все города'
									onChange={handleCityInputChange}
									onFocus={() => setIsCityPickerOpen(true)}
									onBlur={() => {
										setTimeout(() => setIsCityPickerOpen(false), 150)
									}}
								/>

								{citySearch && (
									<button
										type='button'
										className='crm-calendar-filter-clear'
										onMouseDown={e => {
											e.preventDefault()
											setCitySearch('')
											setSelectedCity('')
										}}
										title='Очистить город'
									>
										×
									</button>
								)}

								{isCityPickerOpen && (
									<div className='crm-calendar-filter-dropdown'>
										{visibleCityOptions.length > 0 ? (
											visibleCityOptions.map(city => (
												<button
													key={city}
													type='button'
													className='crm-calendar-filter-option'
													onMouseDown={e => {
														e.preventDefault()
														selectCity(city)
													}}
												>
													<span>{city}</span>
												</button>
											))
										) : (
											<div className='crm-calendar-filter-empty'>
												Город не найден
											</div>
										)}
									</div>
								)}
							</div>
						)}

						<div className='crm-calendar-filter-field picker wide'>
							<label>Клиент</label>
							<input
								type='text'
								value={clientSearch}
								placeholder='Все клиенты'
								onChange={handleClientInputChange}
								onFocus={() => setIsClientPickerOpen(true)}
								onBlur={() => {
									setTimeout(() => setIsClientPickerOpen(false), 150)
								}}
							/>

							{clientSearch && (
								<button
									type='button'
									className='crm-calendar-filter-clear'
									onMouseDown={e => {
										e.preventDefault()
										setClientSearch('')
										setSelectedClientId('')
									}}
									title='Очистить клиента'
								>
									×
								</button>
							)}

							{isClientPickerOpen && (
								<div className='crm-calendar-filter-dropdown'>
									{visibleClientOptions.length > 0 ? (
										visibleClientOptions.map(client => (
											<button
												key={client.key}
												type='button'
												className='crm-calendar-filter-option'
												onMouseDown={e => {
													e.preventDefault()
													selectClient(client)
												}}
											>
												<span>{client.label}</span>
												{client.meta && <small>{client.meta}</small>}
											</button>
										))
									) : (
										<div className='crm-calendar-filter-empty'>
											Клиент не найден
										</div>
									)}
								</div>
							)}
						</div>

						{hasActiveFilters && (
							<button
								type='button'
								className='crm-calendar-filter-reset'
								onClick={clearCalendarFilters}
							>
								Сбросить
							</button>
						)}
					</div>
				</div>

				<div className='crm-calendar-toolbar-right'>
					<button
						type='button'
						className='crm-calendar-refresh-btn'
						onClick={fetchCalendar}
						disabled={loading}
					>
						{loading ? 'Загрузка...' : 'Обновить'}
					</button>
				</div>
			</div>

			<div className='crm-calendar-layout'>
				<aside className='crm-calendar-sidebar'>
					<div className='crm-calendar-mini-card'>
						<div className='crm-calendar-mini-title'>Неделя</div>
						<div className='crm-calendar-mini-range'>{weekTitle}</div>
					</div>

					<div className='crm-calendar-mini-card'>
						<div className='crm-calendar-mini-title'>Заявки</div>
						<div className='crm-calendar-counter'>{filteredItems.length}</div>
						<div className='crm-calendar-mini-hint'>
							{filteredItems.length === items.length
								? 'Загружается только открытая неделя'
								: `Показано ${filteredItems.length} из ${items.length}`}
						</div>
					</div>

					<div className='crm-calendar-legend'>
						<div className='crm-calendar-legend-title'>Типы работ</div>

						<div className='crm-calendar-legend-row'>
							<span className='legend-dot group'></span>
							<span>Группа заявок</span>
						</div>

						<div className='crm-calendar-legend-row'>
							<span className='legend-dot installation'></span>
							<span>Установка</span>
						</div>

						<div className='crm-calendar-legend-row'>
							<span className='legend-dot diagnostic'></span>
							<span>Диагностика</span>
						</div>

						<div className='crm-calendar-legend-row'>
							<span className='legend-dot removal'></span>
							<span>Снятие</span>
						</div>

						<div className='crm-calendar-legend-row'>
							<span className='legend-dot reflashing'></span>
							<span>Перепрошивка</span>
						</div>
					</div>
				</aside>

				<section className='crm-calendar-main'>
					{error && <div className='crm-calendar-error'>{error}</div>}

					<div className='crm-calendar-week'>
						<div className='crm-calendar-header'>
							<div className='crm-calendar-time-header'>GMT+05</div>

							{weekDays.map((day, index) => {
								const isToday = isSameDay(day, new Date())

								return (
									<div
										key={day.toISOString()}
										className={`crm-calendar-day-header ${
											isToday ? 'today' : ''
										}`}
									>
										<div className='crm-calendar-day-name'>
											{weekdayNames[index]}
										</div>
										<div className='crm-calendar-day-number'>
											{isToday ? <span>{day.getDate()}</span> : day.getDate()}
										</div>
									</div>
								)
							})}
						</div>

						<div
							className='crm-calendar-body'
							style={{
								'--slot-height': `${SLOT_HEIGHT}px`,
								'--slot-count': END_HOUR - START_HOUR,
							}}
						>
							<div className='crm-calendar-time-column'>
								{hours.map(hour => (
									<div
										key={hour}
										className='crm-calendar-time-label'
										style={{
											top: `${(hour - START_HOUR) * SLOT_HEIGHT}px`,
										}}
									>
										{String(hour).padStart(2, '0')}:00
									</div>
								))}
							</div>

							<div className='crm-calendar-grid'>
								{weekDays.map((day, dayIndex) => (
									<div
										key={day.toISOString()}
										className={`crm-calendar-day-column ${
											isSameDay(day, new Date()) ? 'today' : ''
										}`}
									>
										{eventGroupsByDay[dayIndex].map(group =>
											group.isGroup
												? renderEventGroup(group, dayIndex)
												: renderSingleEvent(group.items[0]),
										)}

										{currentTime && currentTime.dayIndex === dayIndex && (
											<div
												className='crm-calendar-now-line'
												style={{ top: `${currentTime.top}px` }}
											>
												<span></span>
											</div>
										)}
									</div>
								))}
							</div>
						</div>
					</div>
				</section>
			</div>

			<RequestDetailModal
				isOpen={Boolean(selectedRequestId)}
				requestId={selectedRequestId}
				onClose={() => setSelectedRequestId(null)}
				onUpdated={handleModalUpdated}
			/>
		</div>
	)
}
