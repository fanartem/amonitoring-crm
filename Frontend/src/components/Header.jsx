import React, { useState, useEffect, useRef, useMemo } from 'react'
import { API_BASE_URL, getJsonAuthHeaders } from '../api'
import { NavLink, useNavigate } from 'react-router'
import logoImg from '../assets/logo.png'
import '../styles/Header.css'
import { getWorkTypeLabel } from '../utils/workTypes'
import {
	canAccessRoute,
	getStoredUser,
	hasAnyPermission,
} from '../utils/access'

const NOTIFICATION_SOUND_SRC = '/sounds/notification.wav'
const NOTIFICATION_SOUND_ENABLED_KEY = 'crm_notification_sound_enabled'
const NOTIFICATION_SOUND_VOLUME_KEY = 'crm_notification_sound_volume'
const DEFAULT_NOTIFICATION_SOUND_VOLUME = 0.35

const getNotificationSoundSettings = () => {
	const enabledValue = localStorage.getItem(NOTIFICATION_SOUND_ENABLED_KEY)
	const volumeRawValue = localStorage.getItem(NOTIFICATION_SOUND_VOLUME_KEY)
	const volumeValue = Number(volumeRawValue)

	return {
		enabled: enabledValue === null ? true : enabledValue === '1',
		volume:
			volumeRawValue !== null &&
			Number.isFinite(volumeValue) &&
			volumeValue >= 0 &&
			volumeValue <= 1
				? volumeValue
				: DEFAULT_NOTIFICATION_SOUND_VOLUME,
	}
}

export default function Header() {
	const user = getStoredUser()

	// Каждая ветка поиска включается своим правом.
	// Данные всё равно приходят с бэкенда уже суженными по data_scope.
	const canSearchClients = hasAnyPermission(user, [
		'clients.view',
		'clients.manage',
	])

	const canSearchRequests = hasAnyPermission(user, [
		'requests.view',
		'requests.view_all',
	])

	const canSearchWarehouse = hasAnyPermission(user, [
		'warehouse.view',
		'warehouse.manage',
	])

	const canSearchVehicles = hasAnyPermission(user, [
		'vehicles.view',
		'vehicles.view_all',
		'vehicles.view_own',
		'vehicles.manage',
	])

	const canSeeNotifications = hasAnyPermission(user, ['notifications.view'])

	const logoTo = canAccessRoute('requests', user)
		? '/requests'
		: canAccessRoute('clients', user)
			? '/clients'
			: canAccessRoute('warehouse', user)
				? '/warehouse'
				: '/settings'

	const [query, setQuery] = useState('')
	const [isOpen, setIsOpen] = useState(false)
	const searchRef = useRef(null)
	const navigate = useNavigate()

	const [clients, setClients] = useState([])
	const [requests, setRequests] = useState([])
	const [warehouseItems, setWarehouseItems] = useState([])
	const [vehicleSearchResults, setVehicleSearchResults] = useState([])
	const [notifications, setNotifications] = useState([])
	const [unreadCount, setUnreadCount] = useState(0)
	const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
	const notificationsRef = useRef(null)
	const notificationSoundRef = useRef(null)
	const previousUnreadCountRef = useRef(null)
	const notificationSoundUnlockedRef = useRef(false)

	const playNotificationSound = () => {
		const audio = notificationSoundRef.current

		if (!audio) return

		const soundSettings = getNotificationSoundSettings()

		if (!soundSettings.enabled || soundSettings.volume <= 0) return

		audio.volume = soundSettings.volume
		audio.currentTime = 0

		const playPromise = audio.play()

		if (playPromise?.catch) {
			playPromise.catch(err => {
				if (err?.name === 'NotAllowedError') return
				if (err?.name === 'AbortError') return

				console.warn('Не удалось воспроизвести звук уведомления:', err)
			})
		}
	}

	useEffect(() => {
		const audio = new Audio(NOTIFICATION_SOUND_SRC)
		audio.preload = 'auto'
		audio.volume = getNotificationSoundSettings().volume
		notificationSoundRef.current = audio

		const unlockNotificationSound = () => {
			if (notificationSoundUnlockedRef.current) return
			if (!notificationSoundRef.current) return

			const sound = notificationSoundRef.current
			const previousVolume = sound.volume

			sound.volume = 0
			sound.currentTime = 0

			const playPromise = sound.play()

			if (playPromise?.then) {
				playPromise
					.then(() => {
						sound.pause()
						sound.currentTime = 0
						sound.volume = previousVolume
						notificationSoundUnlockedRef.current = true
					})
					.catch(() => {
						sound.volume = previousVolume
					})

				return
			}

			sound.volume = previousVolume
			notificationSoundUnlockedRef.current = true
		}

		window.addEventListener('pointerdown', unlockNotificationSound, {
			once: true,
		})
		window.addEventListener('keydown', unlockNotificationSound, { once: true })

		return () => {
			window.removeEventListener('pointerdown', unlockNotificationSound)
			window.removeEventListener('keydown', unlockNotificationSound)

			audio.pause()
			notificationSoundRef.current = null
		}
	}, [])

	const fetchNotifications = async () => {
		try {
			const headers = getJsonAuthHeaders()

			const [notificationsRes, countRes] = await Promise.all([
				fetch(`${API_BASE_URL}/notifications?limit=10`, { headers }),
				fetch(`${API_BASE_URL}/notifications/unread-count`, { headers }),
			])

			if (notificationsRes.ok) {
				const data = await notificationsRes.json()
				setNotifications(Array.isArray(data) ? data : [])
			}

			if (countRes.ok) {
				const data = await countRes.json()
				const nextUnreadCount = Number(data.unread_count || 0)
				const previousUnreadCount = previousUnreadCountRef.current

				if (
					previousUnreadCount !== null &&
					nextUnreadCount > previousUnreadCount
				) {
					playNotificationSound()
				}

				previousUnreadCountRef.current = nextUnreadCount
				setUnreadCount(nextUnreadCount)
			}
		} catch (err) {
			console.error('Ошибка загрузки уведомлений:', err)
		}
	}

	const markNotificationAsRead = async notificationId => {
		try {
			const res = await fetch(
				`${API_BASE_URL}/notifications/${notificationId}/read`,
				{
					method: 'PATCH',
					headers: getJsonAuthHeaders(),
				},
			)

			if (res.ok) {
				setNotifications(prev =>
					prev.map(item =>
						item.id === notificationId ? { ...item, is_read: true } : item,
					),
				)

				setUnreadCount(prev => {
					const nextUnreadCount = Math.max(0, prev - 1)
					previousUnreadCountRef.current = nextUnreadCount

					return nextUnreadCount
				})
			}
		} catch (err) {
			console.error('Ошибка отметки уведомления:', err)
		}
	}

	const markAllNotificationsAsRead = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/notifications/read-all`, {
				method: 'PATCH',
				headers: getJsonAuthHeaders(),
			})

			if (res.ok) {
				setNotifications(prev =>
					prev.map(item => ({
						...item,
						is_read: true,
					})),
				)

				previousUnreadCountRef.current = 0
				setUnreadCount(0)
			}
		} catch (err) {
			console.error('Ошибка отметки всех уведомлений:', err)
		}
	}

	const deleteReadNotifications = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/notifications/read`, {
				method: 'DELETE',
				headers: getJsonAuthHeaders(),
			})

			if (res.ok) {
				setNotifications(prev => prev.filter(item => !item.is_read))
				fetchNotifications()
			}
		} catch (err) {
			console.error('Ошибка очистки прочитанных уведомлений:', err)
		}
	}

	const resolveNotificationRequest = async requestId => {
		const localRequest = requests.find(
			item => Number(item.id) === Number(requestId),
		)

		if (localRequest?.scheduled_at) {
			return localRequest
		}

		try {
			const res = await fetch(`${API_BASE_URL}/requests/${requestId}`, {
				headers: getJsonAuthHeaders(),
			})

			if (!res.ok) {
				return localRequest || null
			}

			const data = await res.json()
			return data || localRequest || null
		} catch (err) {
			console.error('Ошибка загрузки заявки для уведомления:', err)
			return localRequest || null
		}
	}

	const handleNotificationClick = async notification => {
		if (!notification.is_read) {
			await markNotificationAsRead(notification.id)
		}

		setIsNotificationsOpen(false)

		const actionId = `${Date.now()}-${Math.random()}`

		if (
			notification.type_code === 'REQUEST_TIME_CONFLICT' &&
			notification.entity_type === 'request' &&
			notification.entity_id
		) {
			const request = await resolveNotificationRequest(notification.entity_id)

			navigate('/calendar', {
				state: {
					highlightRequestId: notification.entity_id,
					highlightScheduledAt: request?.scheduled_at || null,
					searchActionId: actionId,
				},
			})

			return
		}

		if (notification.entity_type === 'request' && notification.entity_id) {
			navigate('/requests', {
				state: {
					openRequestId: notification.entity_id,
					searchActionId: actionId,
				},
			})
		}
	}

	const handleLogout = () => {
		localStorage.removeItem('access_token')
		localStorage.removeItem('user_data')
		window.location.href = '/login'
	}

	// Загружаем лёгкие данные для глобального поиска.
	// Важно: НЕ грузим /vehicles?client_id=... по каждому клиенту.
	useEffect(() => {
		let cancelled = false

		const loadSearchData = async () => {
			try {
				const headers = getJsonAuthHeaders()

				const [resClients, resRequests, resWarehouse] = await Promise.all([
					canSearchClients
						? fetch(`${API_BASE_URL}/clients`, { headers })
								.then(res => (res.ok ? res.json() : []))
								.catch(() => [])
						: Promise.resolve([]),

					canSearchRequests
						? fetch(`${API_BASE_URL}/requests`, { headers })
								.then(res => (res.ok ? res.json() : []))
								.catch(() => [])
						: Promise.resolve([]),

					canSearchWarehouse
						? fetch(`${API_BASE_URL}/warehouse/items`, { headers })
								.then(res => (res.ok ? res.json() : []))
								.catch(() => [])
						: Promise.resolve([]),
				])

				if (cancelled) return

				const activeClients = Array.isArray(resClients)
					? resClients.filter(c => !c.is_deleted)
					: []

				const activeRequests = Array.isArray(resRequests)
					? resRequests.filter(r => !r.is_deleted)
					: []

				const activeWarehouse = Array.isArray(resWarehouse)
					? resWarehouse.filter(item => !item.is_deleted)
					: []

				setClients(activeClients)
				setRequests(activeRequests)
				setWarehouseItems(activeWarehouse)
			} catch (error) {
				console.error('Ошибка при загрузке данных для поиска:', error)
			}
		}

		loadSearchData()

		const intervalId = setInterval(() => {
			if (document.hidden) return
			loadSearchData()
		}, 30000)

		const handleFocus = () => {
			loadSearchData()
		}

		window.addEventListener('focus', handleFocus)

		return () => {
			cancelled = true
			clearInterval(intervalId)
			window.removeEventListener('focus', handleFocus)
		}
	}, [canSearchClients, canSearchRequests, canSearchWarehouse])

	useEffect(() => {
		const q = query.trim()

		if (!canSearchVehicles || q.length < 2) {
			setVehicleSearchResults([])
			return
		}

		let cancelled = false

		const timeoutId = setTimeout(async () => {
			try {
				const res = await fetch(
					`${API_BASE_URL}/vehicles/search?q=${encodeURIComponent(q)}&limit=12`,
					{
						headers: getJsonAuthHeaders(),
					},
				)

				if (!res.ok) {
					if (!cancelled) setVehicleSearchResults([])
					return
				}

				const data = await res.json()

				if (!cancelled) {
					setVehicleSearchResults(Array.isArray(data) ? data : [])
				}
			} catch (err) {
				console.error('Ошибка поиска машин:', err)

				if (!cancelled) {
					setVehicleSearchResults([])
				}
			}
		}, 350)

		return () => {
			cancelled = true
			clearTimeout(timeoutId)
		}
	}, [query, canSearchVehicles])

	useEffect(() => {
		if (!canSeeNotifications) return

		fetchNotifications()

		const intervalId = setInterval(() => {
			fetchNotifications()
		}, 30000)

		return () => clearInterval(intervalId)
	}, [canSeeNotifications])

	const getEquipmentTitle = item => {
		const parts = []

		if (item.name) parts.push(item.name)
		if (item.manufacturer) parts.push(item.manufacturer)
		if (item.model) parts.push(item.model)

		return parts.join(' ') || 'Оборудование'
	}

	const getEquipmentIdentifierText = item => {
		if (item.identifier_value) {
			return `${item.identifier_type || 'ID'}: ${item.identifier_value}`
		}

		if (item.serial_number) {
			return `S/N: ${item.serial_number}`
		}

		return 'Без идентификатора'
	}

	const isDeletedVehicle = vehicle => {
		const value = vehicle?.is_deleted ?? vehicle?.vehicle_is_deleted

		return value === true || value === 1 || value === '1'
	}

	const getVehicleClientName = vehicle => {
		return (
			vehicle.company_name ||
			vehicle.client_company_name ||
			vehicle.client_name ||
			'Клиент'
		)
	}

	const getVehicleSearchTitle = vehicle => {
		const vehicleTitle =
			`${vehicle.brand || ''} ${vehicle.model || ''}`.trim() || 'Авто'

		const plate = vehicle.plate_number ? ` · ${vehicle.plate_number}` : ''

		return `${vehicleTitle}${plate}`
	}

	const getVehicleSearchSubtitle = vehicle => {
		const clientName = getVehicleClientName(vehicle)
		const vin = vehicle.vin ? `VIN: ${vehicle.vin}` : 'VIN не указан'

		if (isDeletedVehicle(vehicle)) {
			return `В КОРЗИНЕ У ${clientName}: ${vin}`
		}

		return `Актуальная машина клиента: ${clientName} · ${vin}`
	}

	const normalizeSearchVin = value =>
		String(value || '')
			.replace(/\s+/g, '')
			.toLowerCase()

	// --- ЛОГИКА КЛИЕНТСКОГО ПОИСКА ---
	const searchResults = useMemo(() => {
		const q = query.toLowerCase().trim()
		if (q.length < 2) return []

		const results = []

		// 1. Поиск по КЛИЕНТАМ
		if (canSearchClients) {
			const matchedClients = clients.filter(
				c =>
					c.name?.toLowerCase().includes(q) ||
					c.company_name?.toLowerCase().includes(q) ||
					c.phone?.includes(q) ||
					c.email?.toLowerCase().includes(q),
			)

			matchedClients.forEach(c => {
				results.push({
					id: c.id,
					title: c.company_name || c.name,
					subtitle: `Клиент • ${c.name}`,
					type: 'client',
				})
			})
		}

		// 2. Поиск по АВТОМОБИЛЯМ
		const vehicleResultsMap = new Map()

		if (canSearchVehicles) {
			const qVin = normalizeSearchVin(q)

			const sortedVehicleSearchResults = [...vehicleSearchResults].sort(
				(a, b) => {
					const aDeleted = isDeletedVehicle(a)
					const bDeleted = isDeletedVehicle(b)

					if (aDeleted !== bDeleted) {
						return aDeleted ? 1 : -1
					}

					const aVinExact = normalizeSearchVin(a.vin) === qVin ? 0 : 1
					const bVinExact = normalizeSearchVin(b.vin) === qVin ? 0 : 1

					if (aVinExact !== bVinExact) {
						return aVinExact - bVinExact
					}

					return (
						Number(b.id || b.vehicle_id || 0) -
						Number(a.id || a.vehicle_id || 0)
					)
				},
			)

			sortedVehicleSearchResults.forEach(v => {
				const vehicleId = v.id || v.vehicle_id

				if (!vehicleId || vehicleResultsMap.has(vehicleId)) return

				vehicleResultsMap.set(vehicleId, {
					id: vehicleId,
					clientId: v.client_id,
					vehicleId,
					title: getVehicleSearchTitle(v),
					subtitle: getVehicleSearchSubtitle(v),
					type: 'vehicle',
					isDeleted: isDeletedVehicle(v),
				})
			})

			// Старый fallback через заявки оставляем, но только если /vehicles/search ещё не вернул эту машину.
			requests.forEach(r => {
				if (!Array.isArray(r.vehicles)) return

				r.vehicles.forEach(v => {
					const matches =
						v.plate_number?.toLowerCase().includes(q) ||
						v.vin?.toLowerCase().includes(q) ||
						v.brand?.toLowerCase().includes(q) ||
						v.model?.toLowerCase().includes(q)

					if (!matches) return

					const vehicleId = v.vehicle_id || v.id
					if (!vehicleId || vehicleResultsMap.has(vehicleId)) return

					const client = clients.find(c => c.id === r.client_id)
					const clientName = client
						? client.company_name || client.name
						: r.company_name || r.client_name || 'Клиент'

					const vehicleTitle =
						`${v.brand || ''} ${v.model || ''}`.trim() || 'Авто'
					const plate = v.plate_number ? ` · ${v.plate_number}` : ''
					const vin = v.vin ? ` · VIN: ${v.vin}` : ''

					vehicleResultsMap.set(vehicleId, {
						id: vehicleId,
						clientId: r.client_id,
						vehicleId,
						title: `${vehicleTitle}${plate}`,
						subtitle: `Автомобиль клиента: ${clientName}${vin}`,
						type: 'vehicle',
						isDeleted: false,
					})
				})
			})
		}

		vehicleResultsMap.forEach(item => results.push(item))

		// 3. Поиск по ЗАЯВКАМ:
		// номер заявки, клиент, телефон, компания, авто внутри заявки
		if (canSearchRequests) {
			const requestResultsMap = new Map()

			requests.forEach(r => {
				const clientName = r.company_name || r.client_name || 'Не указано'

				const clientMatch =
					r.id?.toString().includes(q) ||
					r.client_name?.toLowerCase().includes(q) ||
					r.company_name?.toLowerCase().includes(q) ||
					r.phone?.toLowerCase().includes(q)

				const matchedVehicle =
					Array.isArray(r.vehicles) &&
					r.vehicles.find(
						v =>
							v.plate_number?.toLowerCase().includes(q) ||
							v.vin?.toLowerCase().includes(q) ||
							v.brand?.toLowerCase().includes(q) ||
							v.model?.toLowerCase().includes(q),
					)

				if (!clientMatch && !matchedVehicle) return
				if (requestResultsMap.has(r.id)) return

				const workTypeRu = getWorkTypeLabel(r.work_type)

				const vehicleText = matchedVehicle
					? ` • Авто: ${`${matchedVehicle.brand || ''} ${matchedVehicle.model || ''}`.trim()} ${matchedVehicle.plate_number ? `(${matchedVehicle.plate_number})` : ''}`
					: ''

				requestResultsMap.set(r.id, {
					id: r.id,
					clientId: r.client_id,
					title: `Заявка №${r.id} — ${workTypeRu}`,
					subtitle: `Клиент: ${clientName}${vehicleText}`,
					type: 'request',
				})
			})

			requestResultsMap.forEach(item => results.push(item))
		}

		// 4. Поиск по ОБОРУДОВАНИЮ СКЛАДА:
		// Только для ролей, которым доступен склад.
		if (canSearchWarehouse) {
			const matchedEquipment = warehouseItems.filter(item => {
				const searchableValues = [
					item.name,
					item.manufacturer,
					item.model,
					item.identifier_type,
					item.identifier_value,
					item.serial_number,
					item.client_name,
					item.company_name,
					item.plate_number,
					item.vin,
				]

				return searchableValues.some(value =>
					String(value || '')
						.toLowerCase()
						.includes(q),
				)
			})

			matchedEquipment.forEach(item => {
				const title = getEquipmentTitle(item)
				const identifierText = getEquipmentIdentifierText(item)

				const installedText =
					item.status === 'INSTALLED'
						? ` • Установлено: ${
								item.company_name || item.client_name || 'клиент не указан'
							}${item.plate_number ? ` • ${item.plate_number}` : ''}`
						: ''

				results.push({
					id: item.id,
					title: `${title}`,
					subtitle: `Оборудование • ${identifierText}${installedText}`,
					type: 'equipment',
				})
			})
		}

		return results.slice(0, 8)
	}, [
		query,
		clients,
		requests,
		vehicleSearchResults,
		warehouseItems,
		canSearchClients,
		canSearchRequests,
		canSearchVehicles,
		canSearchWarehouse,
	])

	useEffect(() => {
		const handleClickOutside = event => {
			if (searchRef.current && !searchRef.current.contains(event.target)) {
				setIsOpen(false)
			}

			if (
				notificationsRef.current &&
				!notificationsRef.current.contains(event.target)
			) {
				setIsNotificationsOpen(false)
			}
		}

		document.addEventListener('mousedown', handleClickOutside)
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [])

	const handleResultClick = item => {
		setIsOpen(false)
		setQuery('')

		const actionId = `${Date.now()}-${Math.random()}`

		if (item.type === 'client') {
			navigate('/clients', {
				state: {
					openClientId: item.id,
					searchActionId: actionId,
				},
			})
			return
		}

		if (item.type === 'vehicle') {
			navigate('/clients', {
				state: {
					openClientId: item.clientId,
					highlightVehicleId: item.isDeleted ? null : item.vehicleId,
					highlightDeletedVehicleId: item.isDeleted ? item.vehicleId : null,
					searchActionId: actionId,
				},
			})
			return
		}

		if (item.type === 'request') {
			navigate('/requests', {
				state: {
					openRequestId: item.id,
					searchActionId: actionId,
				},
			})
			return
		}

		if (item.type === 'equipment') {
			navigate('/warehouse', {
				state: {
					highlightWarehouseItemId: item.id,
					searchActionId: actionId,
				},
			})
		}
	}

	return (
		<header className='header'>
			<NavLink className='logo' to={logoTo}>
				<img src={logoImg} alt='Amonitoring' />
			</NavLink>

			{/* 2. ВСЕ ИНТЕРАКТИВНЫЕ ЭЛЕМЕНТЫ ТЕПЕРЬ ТУТ, СТИЛИЗОВАНЫ ЧЕРЕЗ КЛАССЫ */}
			<div className='header-actions'>
				{/* Поисковая строка */}
				<div className='search-wrap' ref={searchRef}>
					<input
						type='text'
						placeholder='Общий поиск'
						value={query}
						onChange={e => {
							setQuery(e.target.value)
							setIsOpen(true)
						}}
						onFocus={() => query.length >= 2 && setIsOpen(true)}
					/>
					<span className='search-icon'>
						<svg
							width='14'
							height='14'
							viewBox='0 0 24 24'
							fill='none'
							stroke='currentColor'
							strokeWidth='2.2'
							strokeLinecap='round'
							strokeLinejoin='round'
						>
							<circle cx='11' cy='11' r='8' />
							<line x1='21' y1='21' x2='16.65' y2='16.65' />
						</svg>
					</span>

					{/* Выпадающий список результатов */}
					{isOpen && searchResults.length > 0 && (
						<div className='search-dropdown'>
							{searchResults.map((item, index) => (
								<div
									key={index}
									className={`search-dropdown-item ${
										item.isDeleted ? 'search-dropdown-item-deleted' : ''
									}`}
									onClick={() => handleResultClick(item)}
								>
									<div className='search-dropdown-item-title'>{item.title}</div>
									<div className='search-dropdown-item-subtitle'>
										{item.subtitle}
									</div>
								</div>
							))}
						</div>
					)}

					{/* Если ввели текст, но совпадений нет */}
					{isOpen && query.trim().length >= 2 && searchResults.length === 0 && (
						<div className='search-dropdown'>
							<div className='search-no-results'>Ничего не найдено</div>
						</div>
					)}
				</div>

				{canSeeNotifications && (
					<div
						className='notification-bell-wrapper'
						ref={notificationsRef}
						title='Уведомления'
					>
						<button
							type='button'
							className='notification-bell-btn'
							onClick={() => {
								setIsNotificationsOpen(prev => !prev)
								fetchNotifications()
							}}
						>
							<svg
								width='22'
								height='22'
								viewBox='0 0 24 24'
								fill='none'
								stroke='currentColor'
								strokeWidth='2'
								strokeLinecap='round'
								strokeLinejoin='round'
								className='bell-icon'
							>
								<path d='M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9'></path>
								<path d='M13.73 21a2 2 0 0 1-3.46 0'></path>
							</svg>

							{unreadCount > 0 && (
								<span className='bell-badge'>
									{unreadCount > 99 ? '99+' : unreadCount}
								</span>
							)}
						</button>

						{isNotificationsOpen && (
							<div className='notifications-dropdown'>
								<div className='notifications-dropdown-header'>
									<div>
										<div className='notifications-title'>Уведомления</div>
										<div className='notifications-subtitle'>
											{unreadCount > 0
												? `Непрочитанных: ${unreadCount}`
												: 'Нет непрочитанных'}
										</div>
									</div>

									<div className='notifications-header-actions'>
										{unreadCount > 0 && (
											<button
												type='button'
												className='notifications-read-all-btn'
												onClick={markAllNotificationsAsRead}
											>
												Прочитать все
											</button>
										)}

										{notifications.some(item => item.is_read) && (
											<button
												type='button'
												className='notifications-clear-read-btn'
												onClick={deleteReadNotifications}
											>
												Очистить прочитанные
											</button>
										)}
									</div>
								</div>

								<div className='notifications-list'>
									{notifications.length === 0 ? (
										<div className='notifications-empty'>
											Уведомлений пока нет
										</div>
									) : (
										notifications.map(notification => (
											<button
												key={notification.id}
												type='button'
												className={`notification-item ${
													notification.is_read ? 'read' : 'unread'
												}`}
												onClick={() => handleNotificationClick(notification)}
											>
												<div className='notification-item-main'>
													<div className='notification-item-title'>
														{notification.title}
													</div>
													<div className='notification-item-message'>
														{notification.message}
													</div>
													<div className='notification-item-date'>
														{notification.created_at
															? new Date(
																	notification.created_at,
																).toLocaleString('ru-RU')
															: ''}
													</div>
												</div>

												{!notification.is_read && (
													<span className='notification-unread-dot' />
												)}
											</button>
										))
									)}
								</div>
							</div>
						)}
					</div>
				)}
			</div>
		</header>
	)
}
