import React, { useState, useEffect, useRef } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import { useLocation } from 'react-router-dom'
import '../styles/Requests.css'
import CreateRequestModal from './CreateRequestModal'
import RequestDetailModal from './RequestDetailModal'
import { getWorkTypeLabel, getWorkTypeColor } from '../utils/workTypes'

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

const getTodayDateInputValue = () => {
	const today = new Date()
	const year = today.getFullYear()
	const month = String(today.getMonth() + 1).padStart(2, '0')
	const day = String(today.getDate()).padStart(2, '0')

	return `${year}-${month}-${day}`
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
		created_by: '',
		status: '',
		payment: '',
		city: '',
		format: '',
		date_from: getTodayDateInputValue(),
		date_to: '',
	})

	const [requestSuccessNotice, setRequestSuccessNotice] = useState('')
	const [isRequestSuccessNoticeLeaving, setIsRequestSuccessNoticeLeaving] = useState(false)
	const [highlightedRequests, setHighlightedRequests] = useState({})
	const requestsSnapshotRef = useRef({})

	const userRole = getUserRole()
	const currentUserId = getCurrentUserId()
	const location = useLocation()

	const canViewRequestPrice =
		userRole !== 'TECHNICIAN' && userRole !== 'SENIOR_TECHNICIAN'

	useEffect(() => {
		fetchRequests({ initial: true })
		fetchCities()
		fetchTechnicians()
	}, [])

	useEffect(() => {
		const intervalId = setInterval(() => {
			if (document.hidden) return
			if (isCreateModalOpen) return

			fetchRequests({ silent: true })
		}, 10000)

		return () => clearInterval(intervalId)
	}, [isCreateModalOpen])

	const canCreateRequest = ['ADMIN', 'ROP', 'MANAGER', 'TECH_SUPPORT'].includes(
		userRole,
	)

	const canViewEquipmentButton = ['ADMIN', 'WAREHOUSE_MANAGER'].includes(
		userRole,
	)

	const canPayRequests = ['ADMIN', 'ROP', 'ACCOUNTANT'].includes(userRole)

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

	const buildRequestSnapshot = req => {
		return JSON.stringify({
			id: req.id,
			status: req.status,
			city: req.city,
			visit_type: req.visit_type,
			address: req.address,
			assigned_to: req.assigned_to,
			is_paid: req.is_paid,
			paid_at: req.paid_at,
			total_price: req.total_price,
			responsible_manager_name: req.responsible_manager_name,
			vehicles: req.vehicles || [],
		})
	}

	const markRequestsHighlighted = changes => {
		if (!changes || Object.keys(changes).length === 0) return

		setHighlightedRequests(prev => ({
			...prev,
			...changes,
		}))

		setTimeout(() => {
			setHighlightedRequests(prev => {
				const next = { ...prev }

				Object.keys(changes).forEach(id => {
					delete next[id]
				})

				return next
			})
		}, 3500)
	}

	const fetchRequests = async ({ silent = false, initial = false } = {}) => {
		try {
			const res = await fetch(`${API_BASE_URL}/requests`, {
				headers: getAuthHeaders(),
			})

			if (res.ok) {
				const data = await res.json()
				const previousSnapshot = requestsSnapshotRef.current || {}
				const hasPreviousSnapshot = Object.keys(previousSnapshot).length > 0

				const nextSnapshot = {}
				const changes = {}

				data.forEach(req => {
					const requestId = String(req.id)
					const snapshot = buildRequestSnapshot(req)

					nextSnapshot[requestId] = snapshot

					if (!initial && hasPreviousSnapshot) {
						if (!previousSnapshot[requestId]) {
							changes[requestId] = 'just-created'
						} else if (previousSnapshot[requestId] !== snapshot) {
							changes[requestId] = 'just-updated'
						}
					}
				})

				requestsSnapshotRef.current = nextSnapshot
				setRequests(data)

				if (silent) {
					markRequestsHighlighted(changes)
				}
			}
		} catch (err) {
			console.error('Ошибка загрузки заявок:', err)
		}
	}

	const fetchTechnicians = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/users/technicians`, {
				headers: getAuthHeaders(),
			})

			if (res.ok) setTechnicians(await res.json())
		} catch (err) {
			console.error(err)
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

	const getCreatorName = req => {
		return req.created_by_name || 'Создатель не указан'
	}

	const getCreatorRoleLabel = req => {
		if (!req.created_by_role) return null
		return roleLabels[req.created_by_role] || req.created_by_role
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

		if (filters.created_by) {
			const creatorFilter = filters.created_by.toLowerCase()
			result = result.filter(r => 
				r.created_by_name && r.created_by_name.toLowerCase().includes(creatorFilter)
			)
		}
		if (filters.date_from) {
			const fromDate = new Date(filters.date_from)
			fromDate.setHours(0, 0, 0, 0)
			result = result.filter(r => new Date(r.created_at) >= fromDate)
		}
		if (filters.date_to) {
			const toDate = new Date(filters.date_to)
			toDate.setHours(23, 59, 59, 999)
			result = result.filter(r => new Date(r.created_at) <= toDate)
		}

		if (filters.status) result = result.filter(r => r.status === filters.status)

		if (filters.payment === 'PAID') {
			result = result.filter(r => Boolean(r.is_paid))
		}

		if (filters.payment === 'UNPAID') {
			result = result.filter(r => !Boolean(r.is_paid))
		}

		if (filters.format)
			result = result.filter(r => r.visit_type === filters.format)

		if (filters.city) result = result.filter(r => r.city === filters.city)

		const statusOrder = {
			NEW: 1,
			IN_PROGRESS: 2,
			COMPLETED: 3,
			CANCELLED: 4,
		}

		result = [...result].sort((a, b) => {
			const statusA = statusOrder[a.status] || 99
			const statusB = statusOrder[b.status] || 99

			if (statusA !== statusB) {
				return statusA - statusB
			}

			const dateA = new Date(a.created_at).getTime()
			const dateB = new Date(b.created_at).getTime()

			return dateB - dateA
		})

		setFilteredRequests(result)

		setFilteredRequests(result)
	}, [filters, requests])

	const handleFilterChange = e =>
		setFilters({ ...filters, [e.target.name]: e.target.value })

	const resetFilters = () =>
		setFilters({
			search: '',
			created_by: '',
			status: '',
			payment: '',
			city: '',
			format: '',
			date_from: '',
			date_to: '',
		})

	const statusLabels = {
		NEW: 'В ожидании',
		IN_PROGRESS: 'Принято в работу',
		CANCELLED: 'Отменено',
		COMPLETED: 'Работы завершены',
	}

	const statusClasses = {
		NEW: 'status-new',
		IN_PROGRESS: 'status-progress',
		COMPLETED: 'status-done',
		CANCELLED: 'status-cancelled',
	}

	const roleLabels = {
		ADMIN: 'Админ',
		ROP: 'РОП',
		MANAGER: 'Менеджер',
		TECH_SUPPORT: 'Тех. поддержка',
		SENIOR_TECHNICIAN: 'Старший',
		TECHNICIAN: 'Монтажник',
		ACCOUNTANT: 'Бухгалтер',
		WAREHOUSE_MANAGER: 'Зав. складом',
	}

	const roleClasses = {
		ADMIN: 'role-admin',
		ROP: 'role-rop',
		MANAGER: 'role-manager',
		TECH_SUPPORT: 'role-support',
		SENIOR_TECHNICIAN: 'role-senior',
		TECHNICIAN: 'role-tech',
		ACCOUNTANT: 'role-accountant',
		WAREHOUSE_MANAGER: 'role-warehouse',
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
			const res = await fetch(`${API_BASE_URL}/requests/${reqId}`, {
				method: 'PATCH',
				headers: getJsonAuthHeaders(),
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
			const res = await fetch(`${API_BASE_URL}/requests/${req.id}/accept`, {
				method: 'POST',
				headers: getJsonAuthHeaders(),
			})

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

		if (['ADMIN', 'ROP', 'SENIOR_TECHNICIAN'].includes(userRole)) {
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
			const res = await fetch(`${API_BASE_URL}/requests/${req.id}/complete`, {
				method: 'PATCH',
				headers: getJsonAuthHeaders(),
			})

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
		) {
			return
		}

		try {
			const res = await fetch(`${API_BASE_URL}/requests/${reqId}`, {
				method: 'DELETE',
				headers: getAuthHeaders(),
			})

			if (res.ok) {
				alert('Заявка удалена!')
				fetchRequests()
			} else {
				const errData = await res.json().catch(() => null)
				throw new Error(errData?.detail || 'Ошибка при удалении заявки')
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
			const res = await fetch(`${API_BASE_URL}/requests/${reqId}`, {
				headers: getAuthHeaders(),
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
				['Тип работ', getWorkTypeLabel(req.work_type)],
				[
					'Формат',
					req.visit_type === 'ON_SITE' ? 'Выезд к клиенту' : 'В офисе',
				],
				['Клиент', getClientDisplayName(req)],
				['Компания', req.company_name || '—'],
				['Телефон', req.phone || '—'],
				[],
				['Автомобили в заявке', ''],
			]

			if (canViewRequestPrice) {
				rows.push(
					[
						'Статус оплаты',
						Boolean(req.is_paid) ? 'Оплачено' : 'Ожидает оплаты',
					],
					['Стоимость заявки', formatMoney(req.total_price)],
				)
			}

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

	const showRequestSuccessNotice = message => {
		setRequestSuccessNotice(message)
		setIsRequestSuccessNoticeLeaving(false)

		setTimeout(() => {
			setIsRequestSuccessNoticeLeaving(true)
		}, 6500)

		setTimeout(() => {
			setRequestSuccessNotice('')
			setIsRequestSuccessNoticeLeaving(false)
		}, 7000)
	}

	const getFilterClassName = filterName => {
		const isActive = Boolean(filters[filterName])

		return isActive ? 'filter-input filter-active' : 'filter-input'
	}

	const getFilterSelectClassName = filterName => {
		const isActive = Boolean(filters[filterName])

		return isActive ? 'filter-select filter-active' : 'filter-select'
	}

	return (
		<div className='requests-page-container'>
			<div className='filters-bar'>
				<div className='filter-group filter-main'>
					<label>Глобальный поиск</label>
					<input
						className={getFilterClassName('search')}
						type='text'
						name='search'
						placeholder='ФИО, Телефон, Гос.номер, VIN, Марка...'
						value={filters.search}
						onChange={handleFilterChange}
					/>
				</div>
				<div className='filter-group filter-creator'>
					<label>Создатель заявки</label>
					<input
						className={getFilterClassName('created_by')}
						type='text'
						name='created_by'
						placeholder='ФИО...'
						value={filters.created_by || ''}
						onChange={handleFilterChange}
					/>
				</div>

				<div className='filter-group'>
					<label>Дата от</label>
					<input
						className={getFilterClassName('date_from')}
						type='date'
						name='date_from'
						value={filters.date_from}
						onChange={handleFilterChange}
					/>
				</div>

				<div className='filter-group'>
					<label>Дата до</label>
					<input
						className={getFilterClassName('date_to')}
						type='date'
						name='date_to'
						value={filters.date_to}
						onChange={handleFilterChange}
					/>
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
						<option value='NEW'>В ожидании</option>
						<option value='IN_PROGRESS'>Принято в работу</option>
						<option value='COMPLETED'>Работы завершены</option>
						<option value='CANCELLED'>Отмененные заявки</option>
					</select>
				</div>
				<div className='filter-group'>
					<label>Оплата</label>
					<select
						className={getFilterSelectClassName('payment')}
						name='payment'
						value={filters.payment}
						onChange={handleFilterChange}
					>
						<option value=''>Все оплаты</option>
						<option value='PAID'>Оплачено</option>
						<option value='UNPAID'>Не оплачено</option>
					</select>
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
					<label>Формат работы</label>
					<select
						className={getFilterSelectClassName('format')}
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

			<div className='requests-count'>
				Кол-во заявок по фильтру: <strong>{filteredRequests.length}</strong>
			</div>

			{requestSuccessNotice && (
				<div
					className={`request-success-notice ${
						isRequestSuccessNoticeLeaving ? 'leaving' : ''
					}`}
				>
					{requestSuccessNotice}
				</div>
			)}

			<div className='requests-list'>
				{filteredRequests.map(req => (
					<div
						key={req.id}
						className={`request-card ${highlightedRequests[String(req.id)] || ''}`}
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
										color: getWorkTypeColor(req.work_type),
										marginTop: '5px',
										display: 'inline-block',
									}}
								>
									{getWorkTypeLabel(req.work_type)}
								</span>

								{req.client_status && req.client_status !== 'ACTIVE' && (
									<span
										className={`client-status-mini client-status-${req.client_status.toLowerCase()}`}
									>
										{req.client_status === 'DEBTOR'
											? 'Должник'
											: req.client_status === 'BLOCKED'
												? 'Заблокирован'
												: req.client_status}
									</span>
								)}
							</div>

							<div className='card-item'>
								<span className='card-label'>Статус</span>
								<div
									className={`status-badge ${statusClasses[req.status] || 'status-new'}`}
								>
									{statusLabels[req.status] || req.status}
								</div>
							</div>

							<div className='card-item request-creator-card-item'>
								<span className='card-label'>Создано</span>

								<div className='request-creator-row'>
									{req.created_by_role && (
										<span
											className={`request-creator-role-badge ${roleClasses[req.created_by_role] || 'role-tech'}`}
										>
											{getCreatorRoleLabel(req)}
										</span>
									)}

									<span className='request-creator-name'>
										{getCreatorName(req)}
									</span>
								</div>
							</div>

							{req.responsible_manager_name && (
								<div className='card-item request-creator-card-item'>
									<span className='card-label'>Ответственный за клиента </span>
									<span className='request-creator-name'>
										{req.responsible_manager_name}
									</span>
								</div>
							)}

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
									{Boolean(req.can_edit) && (
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
									{(Boolean(req.can_delete) ||
										Boolean(req.can_delete_own_with_time_limit)) && (
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

						<div
							className='role-actions-wrapper'
							style={{
								position: 'absolute',
								bottom: '15px' /* Прижимаем к низу карточки */,
								right: '15px' /* Прижимаем к правому краю */,
								display: 'flex',
								gap: '10px' /* Ровный отступ между всеми кнопками */,
							}}
						>
							{canViewEquipmentButton && (
								<button
									className='btn-green'
									onClick={e => {
										e.stopPropagation()
										setDetailModalTab('equipment')
										setSelectedRequestId(req.id)
									}}
								>
									Оборудование
								</button>
							)}

							{canPayRequests && !req.is_paid && (
								<button
									className='btn-green'
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
										onClick={e => handleAcceptRequest(e, req)}
									>
										Принять заявку
									</button>
								)}

							{canCompleteRequest(req) && (
								<button
									className='btn-complete-request'
									onClick={e => handleCompleteRequest(e, req)}
								>
									Завершить
								</button>
							)}
						</div>
					</div>
				))}
			</div>

			{canCreateRequest && (
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

					if (
						!editRequestData &&
						['MANAGER', 'TECH_SUPPORT'].includes(userRole)
					) {
						showRequestSuccessNotice(
							'Заявка создана. У вас есть 2 минуты, чтобы проверить её и при необходимости удалить.',
						)
					}
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
