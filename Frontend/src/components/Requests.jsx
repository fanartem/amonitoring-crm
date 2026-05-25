import React, { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import '../styles/Requests.css'
import CreateRequestModal from './CreateRequestModal'
import RequestDetailModal from './RequestDetailModal'

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

const getCurrentUserId = () => {
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

		const payload = JSON.parse(jsonPayload)

		return Number(payload.id || payload.sub || null)
	} catch (error) {
		return null
	}
}

export default function Requests() {
	const [requests, setRequests] = useState([])
	const [filteredRequests, setFilteredRequests] = useState([])
	const [technicians, setTechnicians] = useState([])
	const [cities, setCities] = useState([])

	const [isCreateModalOpen, setCreateModalOpen] = useState(false)
	const [selectedRequestId, setSelectedRequestId] = useState(null)
	const [editRequestData, setEditRequestData] = useState(null)
	const [activeDropdown, setActiveDropdown] = useState(null)
	const [detailModalTab, setDetailModalTab] = useState('info')

	const [filters, setFilters] = useState({
		search: '',
		status: '',
		city: '',
		format: '',
	})

	const userRole = getUserRole()
	const currentUserId = getCurrentUserId()
	const location = useLocation()

	const canViewRequestPrice =
		userRole !== 'TECHNICIAN' && userRole !== 'SENIOR_TECHNICIAN'

	useEffect(() => {
		fetchRequests()
		fetchTechnicians()
		fetchCities()
	}, [])

	useEffect(() => {
		const openRequestId = location.state?.openRequestId

		if (!openRequestId) return

		setActiveDropdown(null)
		setCreateModalOpen(false)
		setEditRequestData(null)
		setDetailModalTab('info')
		setSelectedRequestId(Number(openRequestId))
	}, [location.state?.searchActionId])

	useEffect(() => {
		const handleClickOutside = () => setActiveDropdown(null)
		document.addEventListener('click', handleClickOutside)
		return () => document.removeEventListener('click', handleClickOutside)
	}, [])

	const fetchRequests = async () => {
		try {
			const token = localStorage.getItem('access_token')
			const res = await fetch('http://127.0.0.1:8000/requests', {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				const data = await res.json()
				setRequests(data)
				setFilteredRequests(data)
			}
		} catch (err) {
			console.error('Ошибка загрузки заявок:', err)
		}
	}

	const fetchTechnicians = async () => {
		try {
			const token = localStorage.getItem('access_token')
			const res = await fetch('http://127.0.0.1:8000/users/technicians', {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) setTechnicians(await res.json())
		} catch (err) {
			console.error(err)
		}
	}

	const fetchCities = async () => {
		try {
			const token = localStorage.getItem('access_token')

			const res = await fetch('http://127.0.0.1:8000/cities', {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			})

			if (res.ok) {
				const data = await res.json()
				setCities(Array.isArray(data) ? data : [])
			}
		} catch (err) {
			console.error('Ошибка загрузки городов:', err)
		}
	}

	const getTechName = techId => {
		if (!techId) return null
		const tech = technicians.find(t => t.id === techId)
		return tech ? tech.name : `ID: ${techId}`
	}

	const clientTypeLabels = {
		TOO: 'ТОО',
		IP: 'ИП',
		INDIVIDUAL: 'Физ. лицо',
	}

	const getClientDisplayName = req => {
		const clientType = req.client_type || req.type

		if (clientType === 'TOO' || clientType === 'IP') {
			return req.company_name || req.client_name || 'Не указано'
		}

		return req.client_name || req.company_name || 'Не указано'
	}

	const getClientSubtitle = req => {
		const clientType = req.client_type || req.type

		if ((clientType === 'TOO' || clientType === 'IP') && req.client_name) {
			return `${clientTypeLabels[clientType] || clientType} · ${req.client_name}`
		}

		if (clientType === 'INDIVIDUAL') {
			return clientTypeLabels[clientType]
		}

		return null
	}

	const getVehicleTitle = (vehicle, index) => {
		const title =
			`${vehicle.brand || ''} ${vehicle.model || ''}`.trim() ||
			`Авто ${index + 1}`

		const plate = vehicle.plate_number || 'б/н'

		return `${title} (${plate})`
	}

	const getVehicleInstallText = vehicle => {
		return `${vehicle.has_blocking ? 'С блокировкой' : 'Без блокировки'} • ${
			vehicle.has_beacon ? 'Маяк' : 'Без маяка'
		}`
	}

	useEffect(() => {
		let result = requests
		if (filters.search) {
			const s = filters.search.toLowerCase()

			result = result.filter(r => {
				const clientMatch =
					(r.client_name && r.client_name.toLowerCase().includes(s)) ||
					(r.company_name && r.company_name.toLowerCase().includes(s)) ||
					(r.phone && r.phone.toLowerCase().includes(s))

				const vehicleMatch =
					Array.isArray(r.vehicles) &&
					r.vehicles.some(
						v =>
							(v.plate_number && v.plate_number.toLowerCase().includes(s)) ||
							(v.vin && v.vin.toLowerCase().includes(s)) ||
							(v.brand && v.brand.toLowerCase().includes(s)) ||
							(v.model && v.model.toLowerCase().includes(s)),
					)

				return clientMatch || vehicleMatch
			})
		}
		if (filters.status) result = result.filter(r => r.status === filters.status)
		if (filters.format)
			result = result.filter(r => r.visit_type === filters.format)
		if (filters.city) result = result.filter(r => r.city === filters.city)
		setFilteredRequests(result)
	}, [filters, requests])

	const handleFilterChange = e =>
		setFilters({ ...filters, [e.target.name]: e.target.value })
	const resetFilters = () =>
		setFilters({ search: '', status: '', city: '', format: '' })

	const statusLabels = {
		NEW: 'В ожидании',
		IN_PROGRESS: 'В процессе установки',
		DONE: 'Работы завершены',
		CANCELLED: 'Отменено',
		COMPLETED: 'Работы завершены',
	}
	const statusClasses = {
		NEW: 'status-new',
		IN_PROGRESS: 'status-progress',
		DONE: 'status-done',
		COMPLETED: 'status-done',
		CANCELLED: 'status-cancelled',
	}

	const formatDate = dateString => {
		if (!dateString) return '—'
		const d = new Date(dateString)
		return (
			d.toLocaleDateString('ru-RU') +
			' ' +
			d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
		)
	}

	const formatMoney = value => {
		const number = Number(value || 0)

		if (Number.isNaN(number)) return `${value} тг`

		return `${number.toLocaleString('ru-RU')} тг`
	}

	const escapeCsvValue = value => {
		if (value === null || value === undefined) return ''

		const str = String(value)

		if (str.includes(';') || str.includes('"') || str.includes('\n')) {
			return `"${str.replace(/"/g, '""')}"`
		}

		return str
	}

	const downloadCsv = (rows, filename) => {
		const csvContent = rows
			.map(row => row.map(escapeCsvValue).join(';'))
			.join('\n')

		const blob = new Blob(['\ufeff' + csvContent], {
			type: 'text/csv;charset=utf-8;',
		})

		const url = URL.createObjectURL(blob)
		const link = document.createElement('a')

		link.href = url
		link.setAttribute('download', filename)
		document.body.appendChild(link)
		link.click()
		document.body.removeChild(link)
		URL.revokeObjectURL(url)
	}

	const toggleDropdown = (e, reqId) => {
		e.stopPropagation()
		setActiveDropdown(prev => (prev === reqId ? null : reqId))
	}

	// --- ИСПРАВЛЕННЫЕ ФУНКЦИИ КНОПОК ---

	// 1. Оплата заявки (для Бухгалтера)
	const handlePayRequest = async (e, reqId) => {
		e.stopPropagation()
		if (!window.confirm('Отметить заявку как оплаченную?')) return

		try {
			const token = localStorage.getItem('access_token')
			const res = await fetch(`http://127.0.0.1:8000/requests/${reqId}`, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({ is_paid: true }),
			})
			if (!res.ok) throw new Error('Ошибка при обновлении статуса оплаты')

			fetchRequests()
		} catch (err) {
			alert(err.message)
		}
	}

	// 2. Принятие заявки (для Монтажника) - ИСПРАВЛЕНО ПОД НОВЫЙ РОУТ БЭКЕНДА
	const handleAcceptRequest = async (e, req) => {
		e.stopPropagation()
		if (!window.confirm('Принять эту заявку в работу?')) return

		try {
			const token = localStorage.getItem('access_token')
			const res = await fetch(
				`http://127.0.0.1:8000/requests/${req.id}/accept`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
					},
				},
			)

			if (!res.ok) {
				const errData = await res.json()
				throw new Error(errData.detail || 'Ошибка при принятии заявки')
			}

			fetchRequests()
		} catch (err) {
			alert(`Ошибка: ${err.message}`)
		}
	}

	const canCompleteRequest = req => {
		if (req.status !== 'IN_PROGRESS') return false
		if (!req.assigned_to) return false

		if (userRole === 'SENIOR_TECHNICIAN') {
			return true
		}

		if (userRole === 'TECHNICIAN') {
			return Number(req.assigned_to) === Number(currentUserId)
		}

		return false
	}

	const handleCompleteRequest = async (e, req) => {
		e.stopPropagation()

		if (
			!window.confirm(
				`Завершить заявку №${req.id}? После подтверждения статус изменится на "Работы завершены".`,
			)
		) {
			return
		}

		try {
			const token = localStorage.getItem('access_token')

			const res = await fetch(
				`http://127.0.0.1:8000/requests/${req.id}/complete`,
				{
					method: 'PATCH',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
					},
				},
			)

			if (!res.ok) {
				const errData = await res.json().catch(() => null)
				throw new Error(errData?.detail || 'Ошибка при завершении заявки')
			}

			fetchRequests()
		} catch (err) {
			alert(`Ошибка: ${err.message}`)
		}
	}

	const handleDeleteRequest = async (e, reqId) => {
		e.stopPropagation()
		setActiveDropdown(null)
		if (
			!window.confirm(
				'Вы уверены, что хотите удалить эту заявку? Она будет перемещена в Корзину.',
			)
		)
			return

		try {
			const token = localStorage.getItem('access_token')
			const res = await fetch(`http://127.0.0.1:8000/requests/${reqId}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				alert('Заявка удалена!')
				fetchRequests()
			} else {
				const errData = await res.text()
				throw new Error(errData || 'Ошибка при удалении заявки')
			}
		} catch (err) {
			alert(err.message)
		}
	}

	const handleMenuOpen = (e, reqId) => {
		e.stopPropagation()
		setActiveDropdown(null)
		setDetailModalTab('info')
		setSelectedRequestId(reqId)
	}

	const handleMenuEdit = (e, req) => {
		e.stopPropagation()
		setActiveDropdown(null)
		setEditRequestData(req)
		setCreateModalOpen(true)
	}

	const handleMenuDownload = async (e, reqId) => {
		e.stopPropagation()
		setActiveDropdown(null)

		try {
			const token = localStorage.getItem('access_token')
			const res = await fetch(`http://127.0.0.1:8000/requests/${reqId}`, {
				headers: { Authorization: `Bearer ${token}` },
			})

			if (!res.ok) throw new Error('Не удалось загрузить данные заявки')

			const data = await res.json()
			const req = data.request
			const vehicles = data.vehicles || req.vehicles || []

			const rows = [
				['Параметр', 'Значение'],
				['Номер заявки', req.id],
				['Дата создания', formatDate(req.created_at)],
				['Статус', statusLabels[req.status] || req.status],
				['Город', req.city || '—'],
				['Адрес выезда', req.address || '—'],
				[
					'Тип работ',
					req.work_type === 'INSTALLATION'
						? 'Установка'
						: req.work_type === 'REMOVAL'
							? 'Снятие'
							: 'Диагностика',
				],
				[
					'Формат',
					req.visit_type === 'ON_SITE' ? 'Выезд к клиенту' : 'В офисе',
				],
				['Клиент', getClientDisplayName(req)],
				['Компания', req.company_name || '—'],
				['Телефон', req.phone || '—'],
				['Статус оплаты', Boolean(req.is_paid) ? 'Оплачено' : 'Ожидает оплаты'],
				['Стоимость заявки', formatMoney(req.total_price)],
				[],
				['Автомобили в заявке', ''],
			]

			if (vehicles.length === 0) {
				rows.push(['Авто', 'Не указаны'])
			} else {
				vehicles.forEach((vehicle, index) => {
					rows.push([])
					rows.push([`Автомобиль ${index + 1}`, ''])
					rows.push(['Марка', vehicle.brand || '—'])
					rows.push(['Модель', vehicle.model || '—'])
					rows.push(['Гос. номер', vehicle.plate_number || 'б/н'])
					rows.push(['VIN-код', vehicle.vin || '—'])
					rows.push(['Год выпуска', vehicle.year || '—'])
					rows.push(['Тип техники', vehicle.vehicle_type || '—'])

					if (req.work_type === 'INSTALLATION') {
						rows.push([
							'Блокировка',
							vehicle.has_blocking ? 'С блокировкой' : 'Без блокировки',
						])
						rows.push(['Маяк', vehicle.has_beacon ? 'С маяком' : 'Без маяка'])
					}
				})
			}

			downloadCsv(rows, `Заявка_№${reqId}.csv`)
		} catch (err) {
			alert(`Ошибка при скачивании: ${err.message}`)
		}
	}

	const handleMenuHistory = (e, reqId) => {
		e.stopPropagation()
		setActiveDropdown(null)
		setDetailModalTab('history')
		setSelectedRequestId(reqId)
	}

	const handleOpenEditFromDetail = reqData => {
		setSelectedRequestId(null)
		setEditRequestData(reqData)
		setCreateModalOpen(true)
	}

	return (
		<div className='requests-page-container'>
			<div className='filters-bar'>
				<div className='filter-group' style={{ flex: '1.5' }}>
					<label>Глобальный поиск</label>
					<input
						className='filter-input'
						type='text'
						name='search'
						placeholder='ФИО, Телефон, Гос.номер, VIN, Марка...'
						value={filters.search}
						onChange={handleFilterChange}
						style={{ minWidth: '250px' }}
					/>
				</div>
				<div className='filter-group'>
					<label>Статус</label>
					<select
						className='filter-select'
						name='status'
						value={filters.status}
						onChange={handleFilterChange}
					>
						<option value=''>Все статусы</option>
						<option value='NEW'>В ожидании</option>
						<option value='IN_PROGRESS'>В процессе установки</option>
						<option value='COMPLETED'>Работы завершены</option>
						<option value='CANCELLED'>Отмененные заявки</option>
					</select>
				</div>
				<div className='filter-group'>
					<label>Город</label>
					<select
						className='filter-select'
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
					<label>Формат работы</label>
					<select
						className='filter-select'
						name='format'
						value={filters.format}
						onChange={handleFilterChange}
					>
						<option value=''>Все форматы</option>
						<option value='ON_SITE'>Выезд к клиенту</option>
						<option value='IN_OFFICE'>В офисе</option>
					</select>
				</div>
				<button className='btn-reset' onClick={resetFilters}>
					Сбросить
				</button>
			</div>

			<div className='requests-list'>
				{filteredRequests.map(req => (
					<div
						key={req.id}
						className='request-card'
						style={{
							zIndex: activeDropdown === req.id ? 100 : 1,
							position: 'relative',
							cursor: 'default',
						}}
					>
						<div className='card-column'>
							<div className='card-item'>
								<span className='card-label'>Клиент</span>

								<span className='card-value'>{getClientDisplayName(req)}</span>

								{getClientSubtitle(req) && (
									<span
										style={{
											fontSize: '12px',
											color: '#888',
											fontWeight: '400',
											marginTop: '2px',
										}}
									>
										{getClientSubtitle(req)}
									</span>
								)}

								<span
									style={{
										fontSize: '15px',
										fontWeight: '600',
										color:
											req.work_type === 'INSTALLATION'
												? '#1565c0'
												: req.work_type === 'REMOVAL'
													? '#c62828'
													: '#e65100',
										marginTop: '5px',
										display: 'inline-block',
									}}
								>
									{req.work_type === 'INSTALLATION'
										? 'Установка'
										: req.work_type === 'REMOVAL'
											? 'Снятие'
											: 'Диагностика'}
								</span>
							</div>
							<div className='card-item'>
								<span className='card-label'>Статус</span>
								<div
									className={`status-badge ${statusClasses[req.status] || 'status-new'}`}
								>
									{statusLabels[req.status] || req.status}
								</div>
							</div>
							{req.assigned_to && (
								<div className='card-item' style={{ marginTop: '5px' }}>
									<span className='card-label'>Исполнитель</span>
									<span
										className='card-value'
										style={{
											fontWeight: '600',
											color: '#5e9424',
											fontSize: '13px',
										}}
									>
										{getTechName(req.assigned_to)}
									</span>
								</div>
							)}
						</div>

						<div className='card-column'>
							<div className='card-item'>
								<span className='card-label'>Авто</span>

								<div className='client-request-lines'>
									{req.vehicles && req.vehicles.length > 0 ? (
										req.vehicles.map((vehicle, index) => (
											<div
												key={vehicle.request_vehicle_id || index}
												className='client-request-line'
											>
												{getVehicleTitle(vehicle, index)}
											</div>
										))
									) : (
										<span className='card-value'>Авто не указаны</span>
									)}
								</div>
							</div>
							<div className='card-item'>
								<span className='card-label'>Город</span>
								<span className='card-value'>{req.city || 'Не указан'}</span>
							</div>
						</div>

						<div className='card-column'>
							<div className='card-item'>
								<span className='card-label'>Параметры</span>

								<div className='client-request-lines'>
									{req.work_type === 'INSTALLATION' &&
									req.vehicles &&
									req.vehicles.length > 0 ? (
										req.vehicles.map((vehicle, index) => {
											const title =
												`${vehicle.brand || ''} ${vehicle.model || ''}`.trim() ||
												`Авто ${index + 1}`

											return (
												<div
													key={vehicle.request_vehicle_id || index}
													className='client-request-line'
												>
													{title}: {getVehicleInstallText(vehicle)}
												</div>
											)
										})
									) : (
										<span style={{ color: '#aaa' }}>—</span>
									)}
								</div>
							</div>
							<div className='card-item'>
								<span className='card-label'>Формат</span>
								<span className='card-value'>
									{req.visit_type === 'ON_SITE' ? (
										<>
											Выезд к клиенту
											{/* --- НОВОЕ: Вывод адреса при выезде --- */}
											{req.address && (
												<div
													style={{
														fontSize: '12px',
														color: '#666',
														marginTop: '3px',
														fontWeight: 'normal',
														lineHeight: '1.2',
													}}
												>
													📍 {req.address}
												</div>
											)}
										</>
									) : (
										'В офисе'
									)}
								</span>
							</div>
						</div>

						<div className='card-column'>
							<div className='card-item'>
								<span className='card-label'>Дата</span>
								<span className='card-value'>{formatDate(req.created_at)}</span>
							</div>
							{canViewRequestPrice && (
								<div className='card-item request-card-price-box'>
									<span className='card-label'>Стоимость</span>
									<span className='request-card-price-value'>
										{formatMoney(req.total_price)}
									</span>
								</div>
							)}
							<div className='card-item'>
								<span className='card-label'>Оплата</span>
								<div
									style={{
										display: 'flex',
										flexDirection: 'row',
										gap: '8px',
										alignItems: 'center',
										marginTop: '2px',
									}}
								>
									<div
										className={`status-badge ${Boolean(req.is_paid) ? 'status-progress' : 'status-new'}`}
										style={{ padding: '2px 10px', fontSize: '11px' }}
									>
										{Boolean(req.is_paid) ? 'Оплачено' : 'Ожидает оплаты'}
									</div>
									{Boolean(req.is_paid) && req.paid_at && (
										<span
											style={{
												fontSize: '11px',
												color: '#888',
												fontWeight: '500',
											}}
										>
											{formatDate(req.paid_at).split(' ')[0]}
										</span>
									)}{' '}
								</div>
							</div>
						</div>

						{/* --- ВЕРХНИЙ ПРАВЫЙ УГОЛ: Детали и меню --- */}
						<div
							className='card-actions-wrapper'
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '10px',
								position: 'absolute',
								top: '15px',
								right: '15px',
							}}
						>
							<button
								className='btn-details'
								onClick={e => {
									e.stopPropagation()
									setDetailModalTab('info')
									setSelectedRequestId(req.id)
								}}
							>
								Детали
							</button>
							<div
								className='card-actions'
								onClick={e => toggleDropdown(e, req.id)}
							>
								&#8942;
							</div>

							{activeDropdown === req.id && (
								<div
									className='dropdown-menu'
									style={{ top: '35px', right: '0' }}
								>
									<div
										className='dropdown-item'
										onClick={e => handleMenuOpen(e, req.id)}
									>
										<svg viewBox='0 0 24 24'>
											<path d='M4 4h16v16H4V4zm2 2v12h12V6H6zm2 2h8v2H8V8zm0 4h8v2H8v-2z' />
										</svg>{' '}
										Открыть
									</div>
									{userRole !== 'TECHNICIAN' && (
										<div
											className='dropdown-item'
											onClick={e => handleMenuEdit(e, req)}
										>
											<svg viewBox='0 0 24 24'>
												<path d='M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z' />
											</svg>{' '}
											Редактировать
										</div>
									)}
									<div
										className='dropdown-item'
										onClick={e => handleMenuDownload(e, req.id)}
									>
										<svg viewBox='0 0 24 24'>
											<path d='M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z' />
										</svg>{' '}
										Скачать заявку
									</div>
									<div className='dropdown-divider'></div>
									<div
										className='dropdown-item'
										onClick={e => handleMenuHistory(e, req.id)}
									>
										<svg viewBox='0 0 24 24'>
											<path d='M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z' />
										</svg>{' '}
										История изменений
									</div>
									{userRole === 'ADMIN' && (
										<>
											<div className='dropdown-divider'></div>
											<div
												className='dropdown-item'
												style={{ color: '#c62828' }}
												onClick={e => handleDeleteRequest(e, req.id)}
											>
												<svg viewBox='0 0 24 24' fill='#c62828'>
													<path d='M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z' />
												</svg>{' '}
												Удалить заявку
											</div>
										</>
									)}
								</div>
							)}
						</div>

						{/* --- НИЖНИЙ ПРАВЫЙ УГОЛ: Кнопки действий по ролям --- */}
						<div
							className='role-actions-wrapper'
							style={{
								position: 'absolute',
								bottom: '15px' /* Прижимаем к низу карточки */,
								right: '15px' /* Прижимаем к правому краю */,
								display: 'flex',
								gap: '10px',
							}}
						>
							{(userRole === 'WAREHOUSE_MANAGER' || userRole === 'ADMIN') && (
								<button
									className='btn-green'
									style={{
										marginBottom: '12px',
										marginRight: '30px',
									}}
									onClick={e => {
										e.stopPropagation()
										setDetailModalTab('equipment')
										setSelectedRequestId(req.id)
									}}
								>
									Оборудование
								</button>
							)}

							{userRole === 'ACCOUNTANT' && !req.is_paid && (
								<button
									className='btn-green'
									style={{
										marginBottom: '12px',
										marginRight: '30px',
									}}
									onClick={e => handlePayRequest(e, req.id)}
								>
									Оплатить
								</button>
							)}

							{(userRole === 'TECHNICIAN' ||
								userRole === 'SENIOR_TECHNICIAN') &&
								req.status === 'NEW' &&
								!req.assigned_to && (
									<button
										className='btn-green'
										style={{
											marginBottom: '12px',
											marginRight: '30px',
										}}
										onClick={e => handleAcceptRequest(e, req)}
									>
										Принять заявку
									</button>
								)}

							{canCompleteRequest(req) && (
								<button
									className='btn-complete-request'
									style={{
										marginBottom: '12px',
										marginRight: '30px',
									}}
									onClick={e => handleCompleteRequest(e, req)}
								>
									Завершить
								</button>
							)}
						</div>
					</div>
				))}
			</div>

			{(userRole === 'ADMIN' || userRole === 'MANAGER') && (
				<div className='create-btn-container'>
					<button
						className='btn-create-floating'
						onClick={() => setCreateModalOpen(true)}
					>
						Создать заявку
					</button>
				</div>
			)}

			<CreateRequestModal
				isOpen={isCreateModalOpen}
				editRequestData={editRequestData}
				onClose={() => {
					setCreateModalOpen(false)
					setEditRequestData(null)
				}}
				onCreated={() => {
					setCreateModalOpen(false)
					setEditRequestData(null)
					fetchRequests()
				}}
			/>
			<RequestDetailModal
				isOpen={!!selectedRequestId}
				requestId={selectedRequestId}
				initialTab={detailModalTab}
				onClose={() => {
					setSelectedRequestId(null)
					setDetailModalTab('info')
				}}
				onUpdated={() => fetchRequests()}
				onEditClick={handleOpenEditFromDetail}
			/>
		</div>
	)
}
