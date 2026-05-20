import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import logoImg from '../assets/logo.png'
import '../styles/Header.css' // <-- 1. ИМПОРТИРУЕМ НАШИ НОВЫЕ СТИЛИ (проверь путь к файлу)

export default function Header() {
	const userDataStr = localStorage.getItem('user_data')
	const user = userDataStr ? JSON.parse(userDataStr) : null
	const [query, setQuery] = useState('')
	const [isOpen, setIsOpen] = useState(false)
	const searchRef = useRef(null)
	const navigate = useNavigate()

	const [clients, setClients] = useState([])
	const [requests, setRequests] = useState([])
	const [vehicles, setVehicles] = useState([])
	const [warehouseItems, setWarehouseItems] = useState([])

	const handleLogout = () => {
		localStorage.removeItem('access_token')
		localStorage.removeItem('user_data')
		window.location.href = '/login'
	}

	// Загружаем данные один раз при монтировании компонента
	useEffect(() => {
		const loadData = async () => {
			try {
				const token = localStorage.getItem('access_token')
				const BASE_URL = 'http://127.0.0.1:8000'

				const headers = {
					'Content-Type': 'application/json',
					...(token && { Authorization: `Bearer ${token}` }),
				}

				const [resClients, resRequests, resWarehouse] = await Promise.all([
					fetch(`${BASE_URL}/clients`, { headers })
						.then(res => (res.ok ? res.json() : []))
						.catch(() => []),

					fetch(`${BASE_URL}/requests`, { headers })
						.then(res => (res.ok ? res.json() : []))
						.catch(() => []),

					fetch(`${BASE_URL}/warehouse/items`, { headers })
						.then(res => (res.ok ? res.json() : []))
						.catch(() => []),
				])

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

				// Загружаем автомобили по каждому клиенту, потому что /vehicles требует client_id
				const vehiclesByClients = await Promise.all(
					activeClients.map(client =>
						fetch(`${BASE_URL}/vehicles?client_id=${client.id}`, { headers })
							.then(res => (res.ok ? res.json() : []))
							.catch(() => []),
					),
				)

				const allVehicles = vehiclesByClients
					.flat()
					.filter(vehicle => !vehicle.is_deleted)

				setVehicles(allVehicles)
			} catch (error) {
				console.error('Ошибка при загрузке данных для поиска:', error)
			}
		}

		loadData()
	}, [])

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

	// --- ЛОГИКА КЛИЕНТСКОГО ПОИСКА ---
	const searchResults = useMemo(() => {
		const q = query.toLowerCase().trim()
		if (q.length < 2) return []

		const results = []

		// 1. Поиск по КЛИЕНТАМ
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

		// 2. Поиск по АВТОМОБИЛЯМ (через встроенные vehicles в заявках)
		const vehicleResultsMap = new Map() // duplicate по vehicle id

		requests.forEach(r => {
			if (!Array.isArray(r.vehicles)) return

			r.vehicles.forEach(v => {
				const matches =
					v.plate_number?.toLowerCase().includes(q) ||
					v.vin?.toLowerCase().includes(q) ||
					v.brand?.toLowerCase().includes(q) ||
					v.model?.toLowerCase().includes(q)

				if (!matches) return

				// id машины может быть в v.id или v.vehicle_id
				const vehicleId = v.vehicle_id || v.id
				if (!vehicleId || vehicleResultsMap.has(vehicleId)) return

				const client = clients.find(c => c.id === r.client_id)
				const clientName = client
					? client.company_name || client.name
					: r.company_name || r.client_name || 'Клиент'
				const vehicleTitle =
					`${v.brand || ''} ${v.model || ''}`.trim() || 'Авто'
				const plate = v.plate_number ? ` · ${v.plate_number}` : ''

				vehicleResultsMap.set(vehicleId, {
					id: vehicleId,
					clientId: r.client_id,
					vehicleId,
					title: `${vehicleTitle}${plate}`,
					subtitle: `Автомобиль клиента: ${clientName}`,
					type: 'vehicle',
				})
			})
		})

		// 2.1. Поиск по автомобилям из /vehicles?client_id=...
		// Нужно для авто, которые есть у клиента, но могут ещё не быть в заявках
		vehicles.forEach(v => {
			const matches =
				v.plate_number?.toLowerCase().includes(q) ||
				v.vin?.toLowerCase().includes(q) ||
				v.brand?.toLowerCase().includes(q) ||
				v.model?.toLowerCase().includes(q)

			if (!matches) return

			const vehicleId = v.id || v.vehicle_id
			if (!vehicleId || vehicleResultsMap.has(vehicleId)) return

			const client = clients.find(c => Number(c.id) === Number(v.client_id))

			const clientName = client ? client.company_name || client.name : 'Клиент'

			const vehicleTitle = `${v.brand || ''} ${v.model || ''}`.trim() || 'Авто'
			const plate = v.plate_number ? ` · ${v.plate_number}` : ''

			vehicleResultsMap.set(vehicleId, {
				id: vehicleId,
				clientId: v.client_id,
				vehicleId,
				title: `${vehicleTitle}${plate}`,
				subtitle: `Автомобиль клиента: ${clientName}`,
				type: 'vehicle',
			})
		})

		vehicleResultsMap.forEach(item => results.push(item))

		// 3. Поиск по ЗАЯВКАМ:
		// номер заявки, клиент, телефон, компания, авто внутри заявки
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

			const workTypeRu =
				r.work_type === 'INSTALLATION'
					? 'Установка'
					: r.work_type === 'REMOVAL'
						? 'Снятие'
						: 'Диагностика'

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

		// 4. Поиск по ОБОРУДОВАНИЮ СКЛАДА:
		// IMEI / MAC / serial / название / модель / производитель
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

		return results.slice(0, 8)
	}, [query, clients, requests, vehicles, warehouseItems])

	useEffect(() => {
		const handleClickOutside = event => {
			if (searchRef.current && !searchRef.current.contains(event.target)) {
				setIsOpen(false)
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
					highlightVehicleId: item.vehicleId,
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
			<div className='logo'>
				<img src={logoImg} alt='Amonitoring' />
			</div>

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
									className='search-dropdown-item'
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

				{/* Заглушка для колокольчика уведомлений */}
				<div
					className='notification-bell-wrapper'
					onClick={() => alert('Здесь нужны уведомления')}
					title='Уведомления'
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
					<span className='bell-badge'>3</span>
				</div>
			</div>
		</header>
	)
}
