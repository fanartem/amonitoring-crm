import React, { useState, useEffect, useRef } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import { useLocation, useSearchParams } from 'react-router'
import '../styles/Requests.css'
import CreateRequestModal from './CreateRequestModal'
import RequestDetailModal from './RequestDetailModal'
import { notifyNewRequestCreated } from './notifications/NewRequestNotice'
import { getWorkTypeLabel, getWorkTypeColor } from '../utils/workTypes'
import { getStoredUser, hasAnyPermission } from '../utils/access'

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

const getVisitPriceCodeLabel = code => {
	if (code === 'ON_SITE_OUTSIDE_CITY') return 'За пределами города'
	if (code === 'BUSINESS_TRIP_KM') return 'Командировка'
	return 'В черте города'
}

const REQUEST_FILTERS_STORAGE_KEY = 'requests_filters_state'

const DEFAULT_REQUEST_FILTERS = {
	search: '',
	created_by: '',
	assigned_to: '',
	status: '',
	work_type: '',
	payment: '',
	city: '',
	format: '',
	date_from: '',
	date_to: '',
	sort_mode: 'STATUS_FLOW',
}

const REQUEST_FILTER_KEYS = Object.keys(DEFAULT_REQUEST_FILTERS)

const getInitialRequestFilters = searchParams => {
	const hasUrlFilters = REQUEST_FILTER_KEYS.some(key => searchParams.has(key))

	if (hasUrlFilters) {
		return {
			...DEFAULT_REQUEST_FILTERS,
			...REQUEST_FILTER_KEYS.reduce((acc, key) => {
				const value = searchParams.get(key)

				if (value !== null) {
					acc[key] = value
				}

				return acc
			}, {}),
		}
	}

	try {
		const saved = sessionStorage.getItem(REQUEST_FILTERS_STORAGE_KEY)

		if (!saved) return DEFAULT_REQUEST_FILTERS

		const parsed = JSON.parse(saved)

		return {
			...DEFAULT_REQUEST_FILTERS,
			...parsed,
		}
	} catch {
		return DEFAULT_REQUEST_FILTERS
	}
}

export default function Requests() {
	const [requests, setRequests] = useState([])
	const [filteredRequests, setFilteredRequests] = useState([])
	const [technicians, setTechnicians] = useState([])
	const [techniciansLookup, setTechniciansLookup] = useState([])
	const [cities, setCities] = useState([])

	const [isCreateModalOpen, setCreateModalOpen] = useState(false)
	const [selectedRequestId, setSelectedRequestId] = useState(null)
	const [editRequestData, setEditRequestData] = useState(null)
	const [activeDropdown, setActiveDropdown] = useState(null)
	const [detailModalTab, setDetailModalTab] = useState('info')

	// Фильтры хранятся и в URL (query-параметры) — так отфильтрованный вид
	// можно скинуть ссылкой, и он переживает обновление страницы/кнопку "назад".
	const [searchParams, setSearchParams] = useSearchParams()

	const [filters, setFilters] = useState(() =>
		getInitialRequestFilters(searchParams),
	)

	const [highlightedRequests, setHighlightedRequests] = useState({})
	const [pendingScrollRequestId, setPendingScrollRequestId] = useState(null)
	const requestsSnapshotRef = useRef({})
	const requestRefs = useRef({})

	// Панель фильтров на мобилке свёрнута по умолчанию — разворачивается
	// по кнопке, чтобы не занимать экран постоянно.
	const [showMobileFilters, setShowMobileFilters] = useState(false)

	const user = getStoredUser()
	const userRole = String(user?.role || getUserRole() || '').toUpperCase()
	const currentUserIdRaw = user?.id ?? user?.user_id ?? getCurrentUserId()
	const currentUserId = Number.isFinite(Number(currentUserIdRaw))
		? Number(currentUserIdRaw)
		: null
	const dataScope = String(user?.data_scope || '').toUpperCase()
	const location = useLocation()

	const hasLegacyRole = roles => roles.includes(userRole)
	const canByPermission = permissionCodes =>
		hasAnyPermission(user, permissionCodes)
	const hasRequestExecutorFlag = Boolean(user?.can_be_request_executor)

	// Пишем текущие фильтры в URL с небольшой задержкой — чтобы не дёргать
	// history API на каждую нажатую клавишу в текстовых полях поиска.
	// Пустые/дефолтные значения в URL не попадают, чтобы адрес оставался чистым.
	useEffect(() => {
		const timeoutId = setTimeout(() => {
			try {
				sessionStorage.setItem(
					REQUEST_FILTERS_STORAGE_KEY,
					JSON.stringify(filters),
				)
			} catch {
				// sessionStorage может быть недоступен в приватном режиме — просто игнорируем
			}

			const next = new URLSearchParams()

			Object.entries(filters).forEach(([key, value]) => {
				if (key === 'sort_mode') {
					if (value && value !== 'STATUS_FLOW') next.set(key, value)
					return
				}

				if (value) next.set(key, value)
			})

			setSearchParams(next, { replace: true })
		}, 300)

		return () => clearTimeout(timeoutId)
	}, [filters]) // eslint-disable-line react-hooks/exhaustive-deps

	const isTechnicianUser =
		hasRequestExecutorFlag ||
		['TECHNICIAN', 'SENIOR_TECHNICIAN'].includes(userRole)

	const canViewAllRequests =
		canByPermission(['requests.view_all', 'requests.manage']) ||
		dataScope === 'ALL' ||
		hasLegacyRole(['ADMIN', 'ROP', 'SENIOR_TECHNICIAN', 'WAREHOUSE_MANAGER'])

	const canViewRequestPrice =
		canByPermission([
			'requests.price.view',
			'requests.prices.view',
			'requests.view_price',
			'requests.view_prices',
			'prices.view',
			'requests.payment.manage',
			'requests.pay',
			'requests.manage',
		]) ||
		hasLegacyRole(['ADMIN', 'ROP', 'MANAGER', 'TECH_SUPPORT', 'ACCOUNTANT'])

	const canUseCityFilter = canViewAllRequests || !isTechnicianUser
	const canUsePaymentFilter = canViewRequestPrice

	const [myRequestsFirst, setMyRequestsFirst] = useState(isTechnicianUser)

	function isMyActiveRequest(req) {
		if (!myRequestsFirst) return false
		if (!currentUserId) return false

		return (
			isCurrentUserExecutor(req) &&
			!['COMPLETED', 'CANCELLED'].includes(req.status)
		)
	}

	useEffect(() => {
		fetchRequests({ initial: true })
		fetchCities()
		fetchTechnicians()
		fetchTechniciansLookup()
	}, [])

	useEffect(() => {
		const intervalId = setInterval(() => {
			if (document.hidden) return
			if (isCreateModalOpen) return

			fetchRequests({ silent: true })
		}, 10000)

		return () => clearInterval(intervalId)
	}, [isCreateModalOpen])

	const canCreateRequest =
		canByPermission(['requests.create', 'requests.manage']) ||
		hasLegacyRole(['ADMIN', 'ROP', 'MANAGER', 'TECH_SUPPORT'])

	const canViewEquipmentButton =
		canByPermission([
			'requests.equipment.view',
			'requests.equipment.attach',
			'requests.equipment.manage',
			'warehouse.employee_equipment.manage',
			'warehouse.manage',
		]) || hasLegacyRole(['ADMIN', 'WAREHOUSE_MANAGER'])

	const canPayRequests =
		canByPermission([
			'requests.payment.manage',
			'requests.pay',
			'finance.manage',
			'prices.manage',
			'requests.manage',
		]) || hasLegacyRole(['ADMIN', 'ROP', 'ACCOUNTANT'])

	const canAcceptRequestAsExecutor =
		isTechnicianUser ||
		canByPermission([
			'requests.accept',
			'requests.accept_own',
			'requests.accept_assigned',
		])

	const canShowNewRequestNotice =
		canByPermission([
			'notifications.requests.new',
			'notifications.requests.create',
			'notifications.manage',
		]) || hasLegacyRole(['MANAGER', 'TECH_SUPPORT'])

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
			visit_price_code: req.visit_price_code,
			address: req.address,
			scheduled_at: req.scheduled_at,
			schedule_approval_status: req.schedule_approval_status,
			schedule_approval_reason: req.schedule_approval_reason,
			schedule_approval_comment: req.schedule_approval_comment,
			assigned_to: req.assigned_to,
			executors: req.executors || [],
			client_payment_type: req.client_payment_type,
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

	useEffect(() => {
		if (!pendingScrollRequestId) return

		const requestExistsInFilteredList = filteredRequests.some(
			req => Number(req.id) === Number(pendingScrollRequestId),
		)

		if (!requestExistsInFilteredList) return

		const timeoutId = setTimeout(() => {
			const el = requestRefs.current[Number(pendingScrollRequestId)]

			if (el) {
				el.scrollIntoView({
					behavior: 'smooth',
					block: 'center',
				})
			}

			setPendingScrollRequestId(null)
		}, 150)

		return () => clearTimeout(timeoutId)
	}, [filteredRequests, pendingScrollRequestId])

	const fetchRequests = async ({
		silent = false,
		initial = false,
		scrollToCreatedRequest = false,
		showCreatedNotice = false,
	} = {}) => {
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
				const createdRequests = []

				data.forEach(req => {
					const requestId = String(req.id)
					const snapshot = buildRequestSnapshot(req)

					nextSnapshot[requestId] = snapshot

					if (!initial && hasPreviousSnapshot) {
						if (!previousSnapshot[requestId]) {
							changes[requestId] = 'just-created'
							createdRequests.push(req)
						} else if (previousSnapshot[requestId] !== snapshot) {
							changes[requestId] = 'just-updated'
						}
					}
				})

				requestsSnapshotRef.current = nextSnapshot
				setRequests(data)

				if (scrollToCreatedRequest && createdRequests.length > 0) {
					const ownCreatedRequests = currentUserId
						? createdRequests.filter(
								req => Number(req.created_by) === Number(currentUserId),
							)
						: []

					const candidates =
						ownCreatedRequests.length > 0 ? ownCreatedRequests : createdRequests

					const newestCreatedRequest = [...candidates].sort((a, b) => {
						const dateA = new Date(a.created_at).getTime()
						const dateB = new Date(b.created_at).getTime()

						const safeDateA = Number.isNaN(dateA) ? 0 : dateA
						const safeDateB = Number.isNaN(dateB) ? 0 : dateB

						if (safeDateA !== safeDateB) {
							return safeDateB - safeDateA
						}

						return Number(b.id || 0) - Number(a.id || 0)
					})[0]

					if (newestCreatedRequest?.id) {
						setPendingScrollRequestId(Number(newestCreatedRequest.id))

						setHighlightedRequests(prev => ({
							...prev,
							[String(newestCreatedRequest.id)]: 'just-created',
						}))

						if (showCreatedNotice) {
							notifyNewRequestCreated({
								requestId: newestCreatedRequest.id,
							})
						}
					}
				}

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

	const fetchTechniciansLookup = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/users/technicians/lookup`, {
				headers: getAuthHeaders(),
			})

			if (res.ok) setTechniciansLookup(await res.json())
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

		const tech = techniciansLookup.find(t => Number(t.id) === Number(techId))

		if (!tech) return `ID: ${techId}`

		if (tech.deleted_at || tech.is_active === 0 || tech.is_approved === 0) {
			return `${tech.name} (удалён)`
		}

		return tech.name
	}

	const getRequestExecutors = req => {
		if (Array.isArray(req.executors) && req.executors.length > 0) {
			return req.executors.map(executor => ({
				id: executor.user_id,
				name: executor.user_name || getTechName(executor.user_id),
			}))
		}

		if (req.assigned_to) {
			return [
				{
					id: req.assigned_to,
					name: getTechName(req.assigned_to),
				},
			]
		}

		return []
	}

	const getExecutorsLabel = req => {
		const executors = getRequestExecutors(req)

		if (executors.length === 0) return null

		return executors.length === 1 ? 'Исполнитель' : 'Исполнители'
	}

	const getExecutorsText = req => {
		const executors = getRequestExecutors(req)

		if (executors.length === 0) return null

		return executors
			.map(executor => executor.name || `ID: ${executor.id}`)
			.join(', ')
	}

	const getClientPaymentTypeLabel = paymentType => {
		if (paymentType === 'POSTPAYMENT') return 'Постоплата'
		return 'Предоплата'
	}

	const getRequestPaymentText = req => {
		const paymentType = req.client_payment_type || 'PREPAYMENT'
		const isPaid = Boolean(req.is_paid)

		if (paymentType === 'POSTPAYMENT') {
			return isPaid ? 'Постоплата · оплачено' : 'Постоплата · не оплачено'
		}

		return isPaid ? 'Предоплата · оплачено' : 'Предоплата · не оплачено'
	}

	const getRequestPaymentClass = req => {
		if (req.client_payment_type === 'POSTPAYMENT') {
			return req.is_paid ? 'payment-postpaid-paid' : 'payment-postpaid-unpaid'
		}

		return req.is_paid ? 'payment-paid' : 'payment-unpaid'
	}

	const isCurrentUserExecutor = req => {
		if (!currentUserId) return false

		const executors = getRequestExecutors(req)

		return executors.some(
			executor => Number(executor.id) === Number(currentUserId),
		)
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
			result = result.filter(
				r =>
					r.created_by_name &&
					r.created_by_name.toLowerCase().includes(creatorFilter),
			)
		}

		if (filters.assigned_to) {
			const assigneeFilter = filters.assigned_to.toLowerCase()

			result = result.filter(r => {
				const executorsText = getExecutorsText(r)

				return (
					Boolean(executorsText) &&
					executorsText.toLowerCase().includes(assigneeFilter)
				)
			})
		}
		if (filters.date_from) {
			const fromDate = new Date(filters.date_from)
			fromDate.setHours(0, 0, 0, 0)

			result = result.filter(r => {
				if (!r.scheduled_at) return false

				const scheduledDate = new Date(r.scheduled_at)

				return scheduledDate >= fromDate
			})
		}

		if (filters.date_to) {
			const toDate = new Date(filters.date_to)
			toDate.setHours(23, 59, 59, 999)

			result = result.filter(r => {
				if (!r.scheduled_at) return false

				const scheduledDate = new Date(r.scheduled_at)

				return scheduledDate <= toDate
			})
		}

		if (filters.status) result = result.filter(r => r.status === filters.status)

		if (filters.work_type) {
			result = result.filter(r => r.work_type === filters.work_type)
		}

		if (canUsePaymentFilter && filters.payment === 'PAID') {
			result = result.filter(r => Boolean(r.is_paid))
		}

		if (canUsePaymentFilter && filters.payment === 'UNPAID') {
			result = result.filter(r => !Boolean(r.is_paid))
		}

		if (filters.format)
			result = result.filter(r => r.visit_type === filters.format)

		if (canUseCityFilter && filters.city) {
			result = result.filter(r => r.city === filters.city)
		}

		const getRequestSortGroup = req => {
			if (isMyActiveRequest(req)) return 0

			if (req.status === 'NEW') return 1
			if (req.status === 'IN_PROGRESS') return 2
			if (req.status === 'COMPLETED') return 3
			if (req.status === 'CANCELLED') return 4

			return 99
		}

		const getTime = value => {
			if (!value) return null

			const time = new Date(value).getTime()

			return Number.isNaN(time) ? null : time
		}

		const getOldRequestTime = req => {
			return (
				getTime(req.scheduled_at) ||
				getTime(req.created_at) ||
				Number.MAX_SAFE_INTEGER
			)
		}

		const getFreshRequestTime = req => {
			return (
				getTime(req.completed_at) ||
				getTime(req.cancelled_at) ||
				getTime(req.accepted_at) ||
				getTime(req.updated_at) ||
				getTime(req.status_changed_at) ||
				getTime(req.created_at) ||
				0
			)
		}

		if (filters.sort_mode === 'NEWEST_FIRST') {
			result = [...result].sort((a, b) => {
				const dateA = getTime(a.created_at) || 0
				const dateB = getTime(b.created_at) || 0

				if (dateA !== dateB) {
					return dateB - dateA
				}

				return Number(b.id || 0) - Number(a.id || 0)
			})

			setFilteredRequests(result)
			return
		}

		result = [...result].sort((a, b) => {
			const groupA = getRequestSortGroup(a)
			const groupB = getRequestSortGroup(b)

			if (groupA !== groupB) {
				return groupA - groupB
			}

			// В ожидании — старые сверху, чтобы утренние заявки не терялись.
			if (groupA === 1) {
				const dateA = getOldRequestTime(a)
				const dateB = getOldRequestTime(b)

				if (dateA !== dateB) {
					return dateA - dateB
				}

				return (
					new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
				)
			}

			// Мои, принятые, завершённые и отменённые — новые сверху.
			const dateA = getFreshRequestTime(a)
			const dateB = getFreshRequestTime(b)

			if (dateA !== dateB) {
				return dateB - dateA
			}

			return Number(b.id || 0) - Number(a.id || 0)
		})

		setFilteredRequests(result)
	}, [
		filters,
		requests,
		technicians,
		myRequestsFirst,
		currentUserId,
		canUseCityFilter,
		canUsePaymentFilter,
	])

	const handleFilterChange = e =>
		setFilters({ ...filters, [e.target.name]: e.target.value })

	const resetFilters = () => {
		try {
			sessionStorage.removeItem(REQUEST_FILTERS_STORAGE_KEY)
		} catch {
			// игнорируем
		}

		setFilters(DEFAULT_REQUEST_FILTERS)
	}

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

	const scheduleApprovalLabels = {
		NOT_REQUIRED: 'Согласование не требуется',
		PENDING: 'Ожидает согласования времени',
		APPROVED: 'Время согласовано',
		REJECTED: 'Время отклонено',
	}

	const scheduleApprovalClasses = {
		NOT_REQUIRED: 'not-required',
		PENDING: 'pending',
		APPROVED: 'approved',
		REJECTED: 'rejected',
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

		const executors = getRequestExecutors(req)

		if (executors.length === 0) return false

		const canCompleteAnyRequest =
			canByPermission([
				'requests.status.manage',
				'requests.change_status',
				'requests.complete_any',
				'requests.manage',
			]) || hasLegacyRole(['ADMIN', 'ROP', 'SENIOR_TECHNICIAN'])

		if (canCompleteAnyRequest) {
			return true
		}

		const canCompleteOwnRequest =
			canByPermission([
				'requests.complete_own',
				'requests.complete_assigned',
				'requests.change_own_status',
			]) || isTechnicianUser

		if (canCompleteOwnRequest) {
			return isCurrentUserExecutor(req)
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
				['Дата создания заявки', formatDate(req.created_at)],
				['Дата и время выполнения', formatDate(req.scheduled_at)],
				[
					'Согласование времени',
					req.schedule_approval_status
						? scheduleApprovalLabels[req.schedule_approval_status] ||
							req.schedule_approval_status
						: '—',
				],
				['Статус', statusLabels[req.status] || req.status],
				['Город', req.city || '—'],
				['Адрес выезда', req.address || '—'],
				['Тип работ', getWorkTypeLabel(req.work_type)],
				[
					'Формат',
					req.visit_type === 'ON_SITE' ? 'Выезд к клиенту' : 'В офисе',
				],
				...(req.visit_type === 'ON_SITE'
					? [['Тип выезда', getVisitPriceCodeLabel(req.visit_price_code)]]
					: []),
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

	const getFilterClassName = filterName => {
		const isActive = Boolean(filters[filterName])

		return isActive ? 'filter-input filter-active' : 'filter-input'
	}

	const getFilterSelectClassName = filterName => {
		const isActive = Boolean(filters[filterName])

		return isActive ? 'filter-select filter-active' : 'filter-select'
	}

	// Для бейджа на кнопке "Фильтры" — sort_mode это сортировка, а не фильтр,
	// в счётчик её не включаем.
	const activeFiltersCount = Object.entries(filters).filter(
		([key, value]) => key !== 'sort_mode' && Boolean(value),
	).length

	return (
		<div className='requests-page-container'>
			<div className='requests-toolbar-sticky'>
				<div className='filters-bar filters-bar-top filters-bar-always-visible'>
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

					<div className='filter-group filter-creator'>
						<label>Исполнитель заявки</label>
						<input
							className={getFilterClassName('assigned_to')}
							type='text'
							name='assigned_to'
							placeholder='ФИО исполнителя...'
							value={filters.assigned_to || ''}
							onChange={handleFilterChange}
						/>
					</div>
				</div>

				{/* Кнопка видна только на мобилке — на десктопе фильтры всегда открыты. */}
				<button
					type='button'
					className='mobile-filters-toggle'
					onClick={() => setShowMobileFilters(prev => !prev)}
				>
					<span className='mobile-filters-toggle-label'>
						<i className='fa-solid fa-filter'></i>
						Фильтры
						{activeFiltersCount > 0 && (
							<span className='mobile-filters-badge'>{activeFiltersCount}</span>
						)}
					</span>
					<i
						className={`fa-solid fa-chevron-down mobile-filters-chevron ${
							showMobileFilters ? 'is-open' : ''
						}`}
					></i>
				</button>

				<div
					className={`filters-panel ${showMobileFilters ? 'mobile-open' : ''}`}
				>
					<div className='filters-bar'>
						<div className='filter-group'>
							<label>Запланировано от:</label>
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
							<label>Тип работ</label>
							<select
								className={getFilterSelectClassName('work_type')}
								name='work_type'
								value={filters.work_type}
								onChange={handleFilterChange}
							>
								<option value=''>Все типы</option>
								<option value='INSTALLATION'>
									{getWorkTypeLabel('INSTALLATION')}
								</option>
								<option value='DIAGNOSTIC'>
									{getWorkTypeLabel('DIAGNOSTIC')}
								</option>
								<option value='REMOVAL'>{getWorkTypeLabel('REMOVAL')}</option>
								<option value='REFLASHING'>
									{getWorkTypeLabel('REFLASHING')}
								</option>
							</select>
						</div>
						{canUsePaymentFilter && (
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
						)}
						{canUseCityFilter && (
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
						)}
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
						<div className='filter-group'>
							<label>Сортировка</label>
							<select
								className={
									filters.sort_mode === 'NEWEST_FIRST'
										? 'filter-select filter-active'
										: 'filter-select'
								}
								name='sort_mode'
								value={filters.sort_mode}
								onChange={handleFilterChange}
							>
								<option value='STATUS_FLOW'>
									По статусам: ожидание старые → принятые → завершённые
								</option>
								<option value='NEWEST_FIRST'>Сначала новые</option>
							</select>
						</div>
						<button className='btn-reset' onClick={resetFilters}>
							Сбросить
						</button>
						{isTechnicianUser && (
							<label
								className={`my-requests-toggle ${myRequestsFirst ? 'active' : ''}`}
							>
								<input
									type='checkbox'
									checked={myRequestsFirst}
									onChange={e => setMyRequestsFirst(e.target.checked)}
								/>
								<span>Мои заявки сверху</span>
							</label>
						)}
					</div>
				</div>
			</div>

			<div className='requests-count'>
				Кол-во заявок по фильтру: <strong>{filteredRequests.length}</strong>
			</div>

			<div className='requests-list'>
				{filteredRequests.map(req => (
					<div
						key={req.id}
						ref={el => {
							requestRefs.current[Number(req.id)] = el
						}}
						className={`request-card ${
							isMyActiveRequest(req) ? 'request-card-my-active' : ''
						} ${highlightedRequests[String(req.id)] || ''}`}
						style={{
							zIndex: activeDropdown === req.id ? 100 : 1,
							position: 'relative',
							cursor: 'default',
						}}
					>
						<div className='card-column'>
							<div className='card-item card-item-client'>
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

							<div className='card-item card-item-status'>
								<span className='card-label'>Статус</span>
								<div
									className={`status-badge ${statusClasses[req.status] || 'status-new'}`}
								>
									{statusLabels[req.status] || req.status}
								</div>
								{isMyActiveRequest(req) && (
									<div className='my-request-badge'>Моя заявка</div>
								)}
							</div>

							<div className='card-item request-creator-card-item card-item-created'>
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
								<div className='card-item request-creator-card-item card-item-responsible'>
									<span className='card-label'>Ответственный за клиента </span>
									<span className='request-creator-name'>
										{req.responsible_manager_name}
									</span>
								</div>
							)}

							{getRequestExecutors(req).length > 0 && (
								<div
									className='card-item card-item-executors'
									style={{ marginTop: '5px' }}
								>
									<span className='card-label'>{getExecutorsLabel(req)}</span>
									<span
										className='card-value'
										style={{
											fontWeight: '600',
											color: '#5e9424',
											fontSize: '13px',
											lineHeight: '1.35',
										}}
									>
										{getExecutorsText(req)}
									</span>
								</div>
							)}
						</div>

						<div className='card-column'>
							<div className='card-item card-item-vehicles'>
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
							<div className='card-item card-item-city'>
								<span className='card-label'>Город</span>
								<span className='card-value'>{req.city || 'Не указан'}</span>
							</div>
						</div>

						<div className='card-column'>
							<div className='card-item card-item-params'>
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
							<div className='card-item card-item-format'>
								<span className='card-label'>Формат</span>
								<span className='card-value'>
									{req.visit_type === 'ON_SITE' ? (
										<>
											Выезд к клиенту
											<div
												style={{
													fontSize: '12px',
													color: '#2563eb',
													marginTop: '3px',
													fontWeight: '700',
												}}
											>
												{getVisitPriceCodeLabel(req.visit_price_code)}
											</div>
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
							<div className='card-item card-item-created-date'>
								<span className='card-label'>Дата создания заявки</span>
								<span className='card-value'>{formatDate(req.created_at)}</span>
							</div>
							<div className='card-item card-item-scheduled-date'>
								<span className='card-label'>Дата и время выполнения</span>
								<span className='card-value'>
									{formatDate(req.scheduled_at)}
								</span>

								{req.schedule_approval_status &&
									req.schedule_approval_status !== 'NOT_REQUIRED' && (
										<span
											className={`schedule-approval-badge ${
												scheduleApprovalClasses[req.schedule_approval_status] ||
												'pending'
											}`}
											title={
												req.schedule_approval_reason ||
												req.schedule_approval_comment ||
												scheduleApprovalLabels[req.schedule_approval_status]
											}
										>
											{scheduleApprovalLabels[req.schedule_approval_status] ||
												req.schedule_approval_status}
										</span>
									)}
							</div>
							{canViewRequestPrice && (
								<div className='card-item request-card-price-box'>
									<span className='card-label'>Стоимость</span>
									<span className='request-card-price-value'>
										{formatMoney(req.total_price)}
									</span>
								</div>
							)}
							{canViewRequestPrice && (
								<div className='card-item card-item-payment'>
									<span className='card-label'>Оплата</span>

									<div
										style={{
											display: 'flex',
											flexDirection: 'row',
											gap: '8px',
											alignItems: 'center',
											marginTop: '2px',
											flexWrap: 'wrap',
										}}
									>
										<div
											className={`payment-status ${getRequestPaymentClass(req)}`}
										>
											{getRequestPaymentText(req)}
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
										)}
									</div>
								</div>
							)}
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

							{canAcceptRequestAsExecutor &&
								req.status === 'NEW' &&
								!req.assigned_to &&
								!['PENDING', 'REJECTED'].includes(
									req.schedule_approval_status,
								) && (
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
					const wasEditMode = Boolean(editRequestData)

					setCreateModalOpen(false)
					setEditRequestData(null)

					fetchRequests({
						scrollToCreatedRequest: !wasEditMode,
						showCreatedNotice: !wasEditMode && canShowNewRequestNotice,
					})
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
