import React, { useState, useEffect, useRef } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import { useLocation } from 'react-router'
import '../styles/Clients.css'
import '../styles/Requests.css'

import CreateClientModal from './CreateClientModal'
import RequestDetailModal from './RequestDetailModal'
import AttachmentsPanel from './AttachmentsPanel'
import AttachEquipmentToVehicleModal from './AttachEquipmentToVehicleModal'
import { getWorkTypeLabel, getWorkTypeColor } from '../utils/workTypes'
import { getStoredUser, hasAnyPermission } from '../utils/access'

export default function Clients() {
	const [clients, setClients] = useState([])
	const [clientGroups, setClientGroups] = useState([])
	const [clientGroupsTotal, setClientGroupsTotal] = useState(0)
	const [clientGroupsPage, setClientGroupsPage] = useState(1)
	const [clientGroupsPageSize, setClientGroupsPageSize] = useState(20)

	// Фильтры вкладки клиентов (как в заявках, но адаптированы):
	// статус клиента и ответственный. Они сужают список-навигатор.
	const [clientFilters, setClientFilters] = useState({
		status: '',
		responsible: '',
	})

	// Выпадающий список-навигатор по всем клиентам (замена нерабочего поиска).
	const [pickerQuery, setPickerQuery] = useState('')
	const [isPickerOpen, setIsPickerOpen] = useState(false)

	// Счётчики машин и подклиентов приходят только в /clients/grouped.
	// Копим их по мере загрузки страниц, чтобы в результатах поиска не
	// рисовать "Машин: 0" там, где число просто неизвестно.
	const [knownClientCounts, setKnownClientCounts] = useState({})

	// Автодополнение фильтра по ответственному (ввод имени → список совпадений).
	const [responsibleQuery, setResponsibleQuery] = useState('')
	const [isResponsibleOpen, setIsResponsibleOpen] = useState(false)

	// Панель фильтров на мобилке свёрнута по умолчанию — разворачивается
	// по кнопке, чтобы не занимать экран постоянно (тот же паттерн, что
	// и на вкладке "Заявки"/"Инвентарь").
	const [showMobileFilters, setShowMobileFilters] = useState(false)
	const [expandedGroups, setExpandedGroups] = useState({})
	const [expandedClientNodes, setExpandedClientNodes] = useState({})
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')

	const [selectedClient, setSelectedClient] = useState(null)
	const [clientRequests, setClientRequests] = useState([])
	const [showMonitoringPassword, setShowMonitoringPassword] = useState(false)
	const [clientVehicles, setClientVehicles] = useState([])
	const [isVehiclesLoading, setIsVehiclesLoading] = useState(false)
	const [vehiclesPage, setVehiclesPage] = useState(1)
	const [vehiclesPageSize, setVehiclesPageSize] = useState(20)
	const [vehiclesTotal, setVehiclesTotal] = useState(0)
	const [technicians, setTechnicians] = useState([])
	const [techniciansLookup, setTechniciansLookup] = useState([])
	const [vehicleEquipmentMap, setVehicleEquipmentMap] = useState({})
	const [attachEquipmentVehicle, setAttachEquipmentVehicle] = useState(null)

	const [responsibleManagers, setResponsibleManagers] = useState([])
	const [clientActionLoading, setClientActionLoading] = useState(false)

	const [isCreateModalOpen, setCreateModalOpen] = useState(false)
	const [editClientData, setEditClientData] = useState(null)

	const [selectedRequestId, setSelectedRequestId] = useState(null)
	const [activeDropdown, setActiveDropdown] = useState(null)

	// Состояние для редактируемого автомобиля
	const [editingVehicle, setEditingVehicle] = useState(null)
	const [vehicleFormMode, setVehicleFormMode] = useState('edit')

	const [deletingVehicle, setDeletingVehicle] = useState(null)
	const [deleteVehicleForm, setDeleteVehicleForm] = useState({
		delete_reason_type: 'SERVICE_STOPPED_SIM_BLOCKED',
		delete_reason: '',
	})

	const [deletedVehicles, setDeletedVehicles] = useState([])
	const [showDeletedVehicles, setShowDeletedVehicles] = useState(false)
	const [deletedVehiclesLoading, setDeletedVehiclesLoading] = useState(false)

	// Состояние для переноса автомобиля к другому клиенту
	const [transferringVehicle, setTransferringVehicle] = useState(null)
	const [transferVehicleForm, setTransferVehicleForm] = useState({
		new_client_id: '',
		reason: '',
	})
	const [transferClientQuery, setTransferClientQuery] = useState('')
	const [transferVehicleHistory, setTransferVehicleHistory] = useState([])
	const [transferVehicleHistoryLoading, setTransferVehicleHistoryLoading] =
		useState(false)

	const [vinHistoryVehicle, setVinHistoryVehicle] = useState(null)
	const [vinHistoryData, setVinHistoryData] = useState(null)
	const [vinHistoryLoading, setVinHistoryLoading] = useState(false)

	const [showVehicles, setShowVehicles] = useState(false)

	const currentUser = getStoredUser()
	const location = useLocation()

	// Тот же код, что в Requests.jsx (шаг 179). prices.view сюда не годится:
	// он приезжает по зависимости вместе с prices.client.manage_own.
	const canViewRequestPrice = hasAnyPermission(currentUser, [
		'requests.price.view',
	])

	const canCreateClient = hasAnyPermission(currentUser, ['clients.create'])

	const canDeleteClient = hasAnyPermission(currentUser, ['clients.delete'])

	const canSoftDeleteVehicle = hasAnyPermission(currentUser, [
		'vehicles.delete',
		'vehicles.manage',
	])

	// Совпадает с VEHICLE_TRASH_VIEW_PERMISSION_CODES в vehicles.py.
	const canViewVehicleTrash = hasAnyPermission(currentUser, [
		'vehicles.trash.view',
		'vehicles.deleted.view',
		'vehicles.restore',
		'vehicles.delete',
		'vehicles.manage',
	])

	// Совпадает с can_access_client_vehicles в vehicles.py: сначала «все машины»,
	// иначе — доступ к самому клиенту, который сервер уже посчитал за нас
	// с учётом области видимости.
	const canViewVehiclesForClient = client => {
		if (!client) return false

		if (
			hasAnyPermission(currentUser, [
				'vehicles.view_all',
				'vehicles.manage',
				'clients.view_all',
			])
		) {
			return true
		}

		return Boolean(client.can_open_details)
	}

	// Сервер считает это по каждому клиенту (can_edit_vehicle_for_client
	// в vehicles.py) — правило во фронте больше не дублируем.
	const canEditVehicleForClient = client => Boolean(client?.can_edit_vehicles)

	const canRestoreVehicle = hasAnyPermission(currentUser, [
		'vehicles.restore',
		'vehicles.manage',
	])

	const canTransferVehicle = hasAnyPermission(currentUser, [
		'vehicles.transfer',
		'vehicles.transfer_client',
		'vehicles.manage',
	])

	const canAddVehicleToClient = client => {
		return (
			(Boolean(client?.can_create_request) ||
				hasAnyPermission(currentUser, [
					'vehicles.create',
					'vehicles.manage',
					'clients.manage',
				]) ||
				hasLegacyRole(currentUser, [
					'ADMIN',
					'ROP',
					'MANAGER',
					'TECH_SUPPORT',
				])) &&
			String(client?.status || 'ACTIVE') !== 'BLOCKED'
		)
	}

	// Совпадает с VEHICLE_EQUIPMENT_MANAGE_PERMISSION_CODES в warehouse.py
	// и с AttachEquipmentToVehicleModal (шаг 142).
	const canManageDirectVehicleEquipment = hasAnyPermission(currentUser, [
		'vehicles.equipment.manage',
		'warehouse.vehicle_equipment.manage',
		'warehouse.manage',
	])

	const canOpenClientDetails = client => Boolean(client?.can_open_details)

	const canEditClient = client => Boolean(client?.can_edit)

	const canChangeClientStatus = client => Boolean(client?.can_change_status)

	const canReassignClient = client => Boolean(client?.can_reassign)

	// Сервер считает эти флаги по каждому клиенту с учётом области видимости.
	// Дополнять их глобальной проверкой права нельзя: право есть «вообще»,
	// а флаг говорит «для этого конкретного клиента».
	const canChangeClientPaymentType = client =>
		Boolean(client?.can_change_payment_type)

	const canViewClientMonitoringPassword = client =>
		Boolean(client?.can_view_monitoring_password)

	const getClientPaymentTypeLabel = paymentType => {
		if (paymentType === 'POSTPAYMENT') return 'Постоплата'
		return 'Предоплата'
	}

	const getClientPaymentTypeClass = paymentType => {
		return paymentType === 'POSTPAYMENT' ? 'postpayment' : 'prepayment'
	}

	const getRequestPaymentText = req => {
		const paymentType =
			req.client_payment_type || selectedClient?.payment_type || 'PREPAYMENT'
		const isPaid = Boolean(req.is_paid)

		if (paymentType === 'POSTPAYMENT') {
			return isPaid ? 'Постоплата · оплачено' : 'Постоплата · не оплачено'
		}

		return isPaid ? 'Предоплата · оплачено' : 'Предоплата · не оплачено'
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

	const getRequestExecutorsLabel = req => {
		const executors = getRequestExecutors(req)

		if (executors.length === 0) return 'Не назначены'

		return executors
			.map(executor => executor.name || `ID: ${executor.id}`)
			.join(', ')
	}

	const getClientStatusLabel = status => {
		if (status === 'ACTIVE') return 'Активный'
		if (status === 'DEBTOR') return 'Должник'
		if (status === 'BLOCKED') return 'Заблокирован'
		return status || '—'
	}

	const getClientResponsibleLabel = client => {
		return client?.responsible_manager_name || 'Не назначен'
	}

	// --- Фильтры клиентов + выпадающий навигатор ---

	const handleClientFilterChange = e =>
		setClientFilters(prev => ({ ...prev, [e.target.name]: e.target.value }))

	const resetClientFilters = () => {
		setClientFilters({ status: '', responsible: '' })
		setPickerQuery('')
		setIsPickerOpen(false)
		setResponsibleQuery('')
		setIsResponsibleOpen(false)
	}

	// Менеджеры, подходящие под введённый текст (для автодополнения).
	const filteredResponsibleManagers = (responsibleManagers || []).filter(m => {
		const q = responsibleQuery.trim().toLowerCase()

		if (!q) return true

		return [m.name, m.role]
			.filter(Boolean)
			.some(field => String(field).toLowerCase().includes(q))
	})

	const handleResponsibleQueryChange = e => {
		const value = e.target.value

		setResponsibleQuery(value)
		setIsResponsibleOpen(true)

		// Очистили поле — снимаем фильтр по ответственному.
		if (!value.trim()) {
			setClientFilters(prev => ({ ...prev, responsible: '' }))
		}
	}

	const handlePickResponsible = manager => {
		setClientFilters(prev => ({ ...prev, responsible: String(manager.id) }))
		setResponsibleQuery(manager.name)
		setIsResponsibleOpen(false)
	}

	const getPickerClientName = client => {
		const company = client.company_name
		const person = client.name || client.client_name

		if (company && person && company !== person) {
			return `${company} · ${person}`
		}

		return company || person || `Клиент #${client.id}`
	}

	// Совпадает ли клиент с введённым текстом. Одна функция на поиск в
	// списке и на подсказки, чтобы результаты нигде не расходились.
	const clientMatchesQuery = (client, query) => {
		if (!query) return true

		return [
			client.name,
			client.company_name,
			client.client_name,
			client.bin_iin,
			client.phone,
			client.email,
			client.monitoring_login,
			client.source_client_name,
			client.source_parent_client_name,
		]
			.filter(Boolean)
			.some(field => String(field).toLowerCase().includes(query))
	}

	const clientMatchesFilters = client => {
		if (clientFilters.status && client.status !== clientFilters.status) {
			return false
		}

		if (
			clientFilters.responsible &&
			Number(client.responsible_manager_id) !==
				Number(clientFilters.responsible)
		) {
			return false
		}

		return true
	}

	const clientSearchQuery = pickerQuery.trim().toLowerCase()
	const isClientSearchActive = clientSearchQuery.length > 0

	// Результаты поиска: плоский список карточек вместо групп.
	// Совпадения в начале названия идут первыми — как в заявках.
	const clientSearchResults = !isClientSearchActive
		? []
		: (clients || [])
				.filter(
					c =>
						clientMatchesFilters(c) && clientMatchesQuery(c, clientSearchQuery),
				)
				.map(c => {
					const known = knownClientCounts[String(c.id)]

					if (known && known.vehicle_count !== undefined) {
						return { ...c, ...known }
					}

					return { ...c, __countsUnknown: true }
				})
				.sort((a, b) => {
					const aName = getPickerClientName(a).toLowerCase()
					const bName = getPickerClientName(b).toLowerCase()

					const aStarts = aName.startsWith(clientSearchQuery) ? 0 : 1
					const bStarts = bName.startsWith(clientSearchQuery) ? 0 : 1

					if (aStarts !== bStarts) return aStarts - bStarts

					return aName.localeCompare(bName, 'ru')
				})

	// Полный список клиентов (из /clients), отфильтрованный по статусу,
	// ответственному и тексту — это опции выпадающего навигатора.
	const filteredPickerClients = (clients || [])
		.filter(c => {
			if (clientFilters.status && c.status !== clientFilters.status) {
				return false
			}

			if (
				clientFilters.responsible &&
				Number(c.responsible_manager_id) !== Number(clientFilters.responsible)
			) {
				return false
			}

			const q = pickerQuery.trim().toLowerCase()

			if (!q) return true

			return [
				c.name,
				c.company_name,
				c.client_name,
				c.bin_iin,
				c.phone,
				c.email,
				c.monitoring_login,
			]
				.filter(Boolean)
				.some(field => String(field).toLowerCase().includes(q))
		})
		.slice(0, 50)

	// Переход к клиенту: используем существующий механизм навигации
	// (прокрутка к нужной группе/строке и подсветка).
	const handlePickClient = client => {
		if (!client) return

		setIsPickerOpen(false)
		setPickerQuery(getPickerClientName(client))

		setSelectedClient(null)
		setSelectedRequestId(null)
		setActiveDropdown(null)
		setEditingVehicle(null)
		setPendingOpenClientId(null)
		setPendingHighlightVehicleId(null)
		setPendingHighlightDeletedVehicleId(null)
		setPendingListClientId(Number(client.id))
	}

	const renderClientBadges = client => {
		if (!client) return null

		const status = client.status || 'ACTIVE'
		const paymentType = client.payment_type || 'PREPAYMENT'

		return (
			<div className='client-card-badges'>
				<span
					className={`client-status-badge client-status-${String(status).toLowerCase()}`}
				>
					Статус: {getClientStatusLabel(status)}
				</span>

				<span
					className={`client-payment-badge client-payment-${getClientPaymentTypeClass(paymentType)}`}
				>
					Тип оплаты: {getClientPaymentTypeLabel(paymentType)}
				</span>

				<span className='client-responsible-badge'>
					Ответственный: {getClientResponsibleLabel(client)}
				</span>
			</div>
		)
	}

	const getClientChildrenCount = client => {
		return Number(client?.children_count || client?.children?.length || 0)
	}

	const getClientHierarchyBadgeText = (client, level = 0) => {
		const childrenCount = getClientChildrenCount(client)

		if (level > 0 && childrenCount > 0) {
			return `Подклиент · ${childrenCount} подкл.`
		}

		if (level > 0) {
			return 'Подклиент'
		}

		if (childrenCount > 0) {
			return `Родитель · ${childrenCount} подкл.`
		}

		return null
	}

	// Состояние для навигации из строки поиска
	const [pendingOpenClientId, setPendingOpenClientId] = useState(null)
	const [pendingListClientId, setPendingListClientId] = useState(null)
	const [pendingClientPosition, setPendingClientPosition] = useState(null)

	const [pendingHighlightVehicleId, setPendingHighlightVehicleId] =
		useState(null)

	const [
		pendingHighlightDeletedVehicleId,
		setPendingHighlightDeletedVehicleId,
	] = useState(null)

	const [highlightedVehicleId, setHighlightedVehicleId] = useState(null)
	const [highlightedClientId, setHighlightedClientId] = useState(null)
	const [highlightedGroupName, setHighlightedGroupName] = useState(null)

	const vehicleRefs = useRef({})
	const clientRefs = useRef({})
	const groupRefs = useRef({})

	const [autoHighlightedClients, setAutoHighlightedClients] = useState({})

	const clientGroupsSnapshotRef = useRef({})
	const selectedClientRef = useRef(null)
	const clientGroupsPageRef = useRef(clientGroupsPage)
	const clientGroupsPageSizeRef = useRef(clientGroupsPageSize)
	// Оптимизация пагинации: отмена устаревших запросов и защита от гонок.
	const groupsAbortRef = useRef(null)
	const groupsRequestSeqRef = useRef(0)

	useEffect(() => {
		fetchTechnicians()
		fetchTechniciansLookup()
		fetchClients() // полный список клиентов для выпадающего навигатора

		if (canViewResponsibleFilter) {
			fetchResponsibleManagers()
		}
	}, [])

	useEffect(() => {
		clientGroupsPageRef.current = clientGroupsPage
	}, [clientGroupsPage])

	useEffect(() => {
		clientGroupsPageSizeRef.current = clientGroupsPageSize
	}, [clientGroupsPageSize])

	useEffect(() => {
		fetchClientGroups({
			initial: clientGroupsPage === 1,
			page: clientGroupsPage,
			pageSize: clientGroupsPageSize,
		})
	}, [clientGroupsPage, clientGroupsPageSize])

	useEffect(() => {
		const intervalId = setInterval(() => {
			if (document.hidden) return
			if (isCreateModalOpen) return
			if (editingVehicle) return
			if (clientActionLoading) return

			fetchClientGroups({
				silent: true,
				page: clientGroupsPageRef.current,
				pageSize: clientGroupsPageSizeRef.current,
			})

			if (selectedClientRef.current) {
				fetchClientRequests(selectedClientRef.current.id)
			}
		}, 20000)

		return () => clearInterval(intervalId)
	}, [isCreateModalOpen, editingVehicle, clientActionLoading])

	useEffect(() => {
		selectedClientRef.current = selectedClient
	}, [selectedClient])

	useEffect(() => {
		const handleClickOutside = () => {
			setActiveDropdown(null)
			setIsPickerOpen(false)
			setIsResponsibleOpen(false)
		}
		document.addEventListener('click', handleClickOutside)
		return () => document.removeEventListener('click', handleClickOutside)
	}, [])

	// 1. Читаем state из навигации из Header.jsx.
	// Важно: зависим от searchActionId, чтобы переход работал даже если мы уже на /clients.
	useEffect(() => {
		const openClientId = location.state?.openClientId
		const highlightVehicleId = location.state?.highlightVehicleId
		const highlightDeletedVehicleId = location.state?.highlightDeletedVehicleId

		if (!openClientId) return

		setSelectedRequestId(null)
		setActiveDropdown(null)
		setEditingVehicle(null)

		if (highlightVehicleId) {
			// Поиск активной машины: открываем детали клиента, список машин и подсвечиваем машину.
			setPendingOpenClientId(Number(openClientId))
			setPendingHighlightVehicleId(Number(highlightVehicleId))
			setPendingHighlightDeletedVehicleId(null)
			setPendingListClientId(null)
			return
		}

		if (highlightDeletedVehicleId) {
			// Поиск машины из корзины: открываем детали клиента, корзину машин и подсвечиваем удалённую машину.
			setPendingOpenClientId(Number(openClientId))
			setPendingHighlightVehicleId(null)
			setPendingHighlightDeletedVehicleId(Number(highlightDeletedVehicleId))
			setPendingListClientId(null)
			return
		}

		// Поиск клиента: НЕ открываем детали.
		// Остаёмся во вкладке “Клиенты”, перелистываем к группе и подсвечиваем.
		setSelectedClient(null)
		setPendingOpenClientId(null)
		setPendingHighlightVehicleId(null)
		setPendingHighlightDeletedVehicleId(null)
		setPendingListClientId(Number(openClientId))
	}, [location.state?.searchActionId])

	// 2. Когда клиенты загружены + есть pending → открываем нужного клиента
	useEffect(() => {
		if (
			!pendingOpenClientId ||
			(!pendingHighlightVehicleId && !pendingHighlightDeletedVehicleId)
		) {
			return
		}

		const openClient = async () => {
			const allClients = flattenClientsFromGroups(clientGroups)

			let client = allClients.find(
				c => Number(c.id) === Number(pendingOpenClientId),
			)

			if (!client) {
				client = await fetchClientById(pendingOpenClientId)
			}

			if (!client) return

			setPendingOpenClientId(null)
			handleClientClick(client)
		}

		openClient()
	}, [
		clientGroups,
		pendingOpenClientId,
		pendingHighlightVehicleId,
		pendingHighlightDeletedVehicleId,
	])

	useEffect(() => {
		if (!pendingListClientId) return

		const goToClientPage = async () => {
			const position = await fetchClientGroupedPosition(pendingListClientId)

			if (!position) {
				setPendingListClientId(null)
				return
			}

			setPendingClientPosition(position)

			if (Number(clientGroupsPage) !== Number(position.page)) {
				setClientGroupsPage(Number(position.page))
			}
		}

		goToClientPage()
	}, [pendingListClientId])

	useEffect(() => {
		if (
			!pendingListClientId ||
			!pendingClientPosition ||
			clientGroups.length === 0
		) {
			return
		}

		if (Number(clientGroupsPage) !== Number(pendingClientPosition.page)) {
			return
		}

		const result = findClientInGroups(pendingListClientId)

		if (!result) return

		setExpandedGroups(prev => ({
			...prev,
			[pendingClientPosition.group_name]: true,
		}))

		if (pendingClientPosition.ancestor_ids?.length > 0) {
			setExpandedClientNodes(prev => {
				const next = { ...prev }

				pendingClientPosition.ancestor_ids.forEach(clientId => {
					next[clientId] = true
				})

				return next
			})
		}

		if (pendingClientPosition.is_parent_client) {
			setHighlightedGroupName(pendingClientPosition.group_name)
			setHighlightedClientId(null)
		} else {
			setHighlightedClientId(Number(pendingListClientId))
			setHighlightedGroupName(null)
		}

		setTimeout(() => {
			const el = pendingClientPosition.is_parent_client
				? groupRefs.current[pendingClientPosition.group_name]
				: clientRefs.current[Number(pendingListClientId)]

			if (el) {
				el.scrollIntoView({ behavior: 'smooth', block: 'center' })
			}
		}, 250)

		setTimeout(() => {
			setHighlightedClientId(null)
			setHighlightedGroupName(null)
		}, 2800)

		setPendingListClientId(null)
		setPendingClientPosition(null)
	}, [
		clientGroups,
		clientGroupsPage,
		pendingListClientId,
		pendingClientPosition,
	])

	// 3. Когда клиент открыт + нужна подсветка → автоматически показываем и грузим машины
	useEffect(() => {
		if (!selectedClient || !pendingHighlightVehicleId) return

		setShowVehicles(true)
		openVehiclePageForHighlight(
			selectedClient.id,
			pendingHighlightVehicleId,
			vehiclesPageSize,
		)
	}, [selectedClient?.id, pendingHighlightVehicleId])

	// 4. Когда машины загрузились + есть pending highlight → скролл и подсветка
	useEffect(() => {
		if (!pendingHighlightVehicleId || clientVehicles.length === 0) return

		const vehicleId = Number(pendingHighlightVehicleId)
		const vehicleExists = clientVehicles.some(v => Number(v.id) === vehicleId)

		if (!vehicleExists) return

		setPendingHighlightVehicleId(null)
		setShowVehicles(true)
		setHighlightedVehicleId(vehicleId)

		setTimeout(() => {
			const el = vehicleRefs.current[vehicleId]
			if (el) {
				el.scrollIntoView({ behavior: 'smooth', block: 'center' })
			}
		}, 150)

		setTimeout(() => {
			setHighlightedVehicleId(null)
		}, 2500)
	}, [clientVehicles, pendingHighlightVehicleId])

	// 5. Когда клиент открыт + нужна подсветка машины из корзины → показываем корзину
	useEffect(() => {
		if (!selectedClient || !pendingHighlightDeletedVehicleId) return

		setShowVehicles(false)
		setShowDeletedVehicles(true)
		fetchDeletedVehicles(selectedClient.id)
	}, [selectedClient?.id, pendingHighlightDeletedVehicleId])

	// 6. Когда корзина загрузилась + есть pending highlight → скролл и подсветка
	useEffect(() => {
		if (!pendingHighlightDeletedVehicleId || deletedVehicles.length === 0)
			return

		const vehicleId = Number(pendingHighlightDeletedVehicleId)
		const vehicleExists = deletedVehicles.some(v => Number(v.id) === vehicleId)

		if (!vehicleExists) return

		setPendingHighlightDeletedVehicleId(null)
		setShowDeletedVehicles(true)
		setHighlightedVehicleId(vehicleId)

		setTimeout(() => {
			const el = vehicleRefs.current[vehicleId]

			if (el) {
				el.scrollIntoView({ behavior: 'smooth', block: 'center' })
			}
		}, 150)

		setTimeout(() => {
			setHighlightedVehicleId(null)
		}, 2500)
	}, [deletedVehicles, pendingHighlightDeletedVehicleId])

	const flattenClientsFromGroups = groups => {
		const result = []

		const walkClient = client => {
			if (!client) return

			result.push(client)
			;(client.children || []).forEach(child => walkClient(child))
		}

		;(groups || []).forEach(group => {
			if (group.parent_client) {
				result.push(group.parent_client)
			}

			;(group.clients || []).forEach(client => walkClient(client))
		})

		return result
	}

	const buildClientSnapshot = client => {
		return JSON.stringify({
			id: client.id,
			name: client.name,
			company_name: client.company_name,
			bin_iin: client.bin_iin,
			phone: client.phone,
			email: client.email,
			monitoring_login: client.monitoring_login,
			status: client.status,
			payment_type: client.payment_type,
			responsible_manager_id: client.responsible_manager_id,
			responsible_manager_name: client.responsible_manager_name,
			request_count: client.request_count,
			vehicle_count: client.vehicle_count,
			children_count: client.children_count,
			can_open_details: client.can_open_details,
			can_edit: client.can_edit,
			can_change_status: client.can_change_status,
			can_change_payment_type: client.can_change_payment_type,
			can_reassign: client.can_reassign,
		})
	}

	const markClientsHighlighted = changes => {
		if (!changes || Object.keys(changes).length === 0) return

		setAutoHighlightedClients(prev => ({
			...prev,
			...changes,
		}))

		setTimeout(() => {
			setAutoHighlightedClients(prev => {
				const next = { ...prev }

				Object.keys(changes).forEach(id => {
					delete next[id]
				})

				return next
			})
		}, 3500)
	}

	const fetchClients = async ({ silent = false } = {}) => {
		if (!silent) {
			setLoading(true)
			setError('')
		}

		try {
			const response = await fetch(`${API_BASE_URL}/clients`, {
				headers: getAuthHeaders(),
			})

			if (!response.ok) {
				throw new Error('Не удалось загрузить список клиентов')
			}

			const data = await response.json()
			setClients(data.filter(c => !c.is_deleted))
		} catch (err) {
			if (!silent) {
				setError(err.message)
			}

			console.error('Ошибка загрузки клиентов:', err)
		} finally {
			if (!silent) {
				setLoading(false)
			}
		}
	}

	const fetchClientGroups = async ({
		silent = false,
		initial = false,
		page = clientGroupsPageRef.current,
		pageSize = clientGroupsPageSizeRef.current,
	} = {}) => {
		// Отменяем предыдущий незавершённый запрос групп —
		// при быстрой смене страниц/поиске не тратим сеть и не ловим гонки.
		if (groupsAbortRef.current) {
			groupsAbortRef.current.abort()
		}

		const controller = new AbortController()
		groupsAbortRef.current = controller

		const requestSeq = ++groupsRequestSeqRef.current
		const isLatestRequest = () => requestSeq === groupsRequestSeqRef.current

		if (!silent) {
			setLoading(true)
			setError('')
		}

		try {
			const params = new URLSearchParams({
				page: String(page),
				page_size: String(pageSize),
			})

			const response = await fetch(
				`${API_BASE_URL}/clients/grouped?${params}`,
				{
					headers: getAuthHeaders(),
					signal: controller.signal,
				},
			)

			// Ответ устарел (пришёл новый запрос) — игнорируем результат.
			if (!isLatestRequest()) return

			if (!response.ok) {
				throw new Error('Не удалось загрузить группы клиентов')
			}

			const data = await response.json()

			// Повторная проверка: пока читали тело ответа, мог стартовать новый запрос.
			if (!isLatestRequest()) return

			const groups = Array.isArray(data)
				? data
				: Array.isArray(data.items)
					? data.items
					: []

			setClientGroupsTotal(
				Array.isArray(data) ? groups.length : Number(data.total || 0),
			)

			if (silent) {
				const previousSnapshot = clientGroupsSnapshotRef.current || {}
				const hasPreviousSnapshot = Object.keys(previousSnapshot).length > 0

				const nextSnapshot = {}
				const changes = {}

				flattenClientsFromGroups(groups).forEach(client => {
					const clientId = String(client.id)
					const snapshot = buildClientSnapshot(client)

					nextSnapshot[clientId] = snapshot

					if (hasPreviousSnapshot) {
						if (!previousSnapshot[clientId]) {
							changes[clientId] = 'client-auto-created'
						} else if (previousSnapshot[clientId] !== snapshot) {
							changes[clientId] = 'client-auto-updated'
						}
					}
				})

				clientGroupsSnapshotRef.current = nextSnapshot
				markClientsHighlighted(changes)
			} else {
				const nextSnapshot = {}

				flattenClientsFromGroups(groups).forEach(client => {
					nextSnapshot[String(client.id)] = buildClientSnapshot(client)
				})

				clientGroupsSnapshotRef.current = nextSnapshot
			}

			setKnownClientCounts(prev => {
				const next = { ...prev }

				flattenClientsFromGroups(groups).forEach(client => {
					next[String(client.id)] = {
						vehicle_count: client.vehicle_count,
						children_count: getClientChildrenCount(client),
					}
				})

				return next
			})

			setClientGroups(groups)

			const openedClient = selectedClientRef.current

			if (openedClient) {
				const freshClient = flattenClientsFromGroups(groups).find(
					client => Number(client.id) === Number(openedClient.id),
				)

				if (freshClient) {
					setSelectedClient(prev =>
						prev && Number(prev.id) === Number(freshClient.id)
							? {
									...prev,
									...freshClient,
								}
							: prev,
					)
				}
			}

			if (initial) {
				const initialExpanded = {}

				groups.forEach(group => {
					initialExpanded[group.group_name] = true
				})

				setExpandedGroups(initialExpanded)
			}
		} catch (err) {
			// Запрос отменён более новым — это не ошибка, тихо выходим.
			if (err.name === 'AbortError') {
				return
			}

			if (!silent && isLatestRequest()) {
				setError(err.message)
			}

			console.error('Ошибка загрузки групп клиентов:', err)
		} finally {
			if (groupsAbortRef.current === controller) {
				groupsAbortRef.current = null
			}

			if (!silent && isLatestRequest()) {
				setLoading(false)
			}
		}
	}

	const refreshClientsData = () => {
		fetchClientGroups({
			initial: clientGroupsPageRef.current === 1,
			page: clientGroupsPageRef.current,
			pageSize: clientGroupsPageSizeRef.current,
		})

		if (selectedClientRef.current) {
			fetchClientRequests(selectedClientRef.current.id)
		}
	}

	const updateClientLocally = updatedClient => {
		setSelectedClient(prev => {
			if (!prev || Number(prev.id) !== Number(updatedClient.id)) return prev

			return {
				...prev,
				...updatedClient,
			}
		})

		setClients(prev =>
			prev.map(client =>
				Number(client.id) === Number(updatedClient.id)
					? {
							...client,
							...updatedClient,
						}
					: client,
			),
		)

		const updateClientInTree = items =>
			(items || []).map(client => {
				const nextClient =
					Number(client.id) === Number(updatedClient.id)
						? {
								...client,
								...updatedClient,
							}
						: client

				return {
					...nextClient,
					children: updateClientInTree(nextClient.children || []),
				}
			})

		setClientGroups(prev =>
			prev.map(group => ({
				...group,
				parent_client:
					group.parent_client &&
					Number(group.parent_client.id) === Number(updatedClient.id)
						? {
								...group.parent_client,
								...updatedClient,
							}
						: group.parent_client,
				clients: updateClientInTree(group.clients || []),
			})),
		)
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

	const fetchResponsibleManagers = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/users/responsible-managers`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить ответственных')
			}

			const data = await res.json()
			setResponsibleManagers(Array.isArray(data) ? data : [])
		} catch (err) {
			console.error('Ошибка загрузки ответственных менеджеров:', err)
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

	const clientTypeLabels = {
		TOO: 'ТОО',
		IP: 'ИП',
		INDIVIDUAL: 'Физ. лицо',
	}

	const getClientTypeLabel = type => {
		return clientTypeLabels[type] || type || '—'
	}

	const getClientIdentifierLabel = client => {
		const type = client?.client_type || client?.type

		return type === 'INDIVIDUAL' ? 'ИИН' : 'БИН'
	}

	const getClientIdentifierValue = client => {
		return client?.bin_iin || '—'
	}

	const getClientDisplayName = client => {
		const clientType = client.client_type || client.type

		if (clientType === 'TOO' || clientType === 'IP') {
			return client.company_name || client.client_name || client.name || '—'
		}

		return client.client_name || client.name || client.company_name || '—'
	}

	const getClientSubtitle = client => {
		const clientType = client.client_type || client.type

		if (
			(clientType === 'TOO' || clientType === 'IP') &&
			(client.client_name || client.name)
		) {
			return `${getClientTypeLabel(clientType)} · представитель: ${client.client_name || client.name}`
		}

		return getClientTypeLabel(clientType)
	}

	const getEquipmentBadgeText = item => {
		const titleParts = []

		if (item.name) titleParts.push(item.name)
		if (item.model) titleParts.push(item.model)

		const title = titleParts.join(' ') || 'Оборудование'

		const quantity = Number(item.quantity || 1)
		const quantityText = quantity > 1 ? ` ${quantity} шт.` : ''

		const sourceText =
			item.source_type === 'DIRECT'
				? ' · напрямую'
				: item.request_id
					? ` · заявка #${item.request_id}`
					: ''

		if (item.identifier_value) {
			return `${title}: ${item.identifier_type || 'ID'} ${item.identifier_value}${quantityText}${sourceText}`
		}

		if (item.serial_number) {
			return `${title}: S/N ${item.serial_number}${quantityText}${sourceText}`
		}

		return `${title}${quantityText}${sourceText}`
	}

	const getVehicleEquipment = vehicleId => {
		return vehicleEquipmentMap[vehicleId] || []
	}

	const getEquipmentBadgeKey = item => {
		return item.source_key || `${item.source_type || 'REQUEST'}-${item.link_id}`
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

	const fetchClientRequests = async clientId => {
		try {
			const res = await fetch(`${API_BASE_URL}/clients/${clientId}/requests`, {
				headers: getAuthHeaders(),
			})

			if (res.ok) {
				const data = await res.json()
				setClientRequests(data)
				fetchEquipmentForClientRequests(data)
			}
		} catch (err) {
			console.error('Ошибка загрузки заявок клиента:', err)
		}
	}

	const fetchEquipmentForClientVehicles = async vehiclesList => {
		if (!Array.isArray(vehiclesList) || vehiclesList.length === 0) {
			return
		}

		try {
			const equipmentByVehicle = {}

			await Promise.all(
				vehiclesList.map(async vehicle => {
					if (!vehicle?.id) return

					try {
						const res = await fetch(
							`${API_BASE_URL}/warehouse/vehicles/${vehicle.id}/equipment`,
							{
								headers: getAuthHeaders(),
							},
						)

						if (!res.ok) return

						const equipment = await res.json()

						equipmentByVehicle[vehicle.id] = Array.isArray(equipment)
							? equipment
							: []
					} catch (err) {
						console.error(
							`Ошибка загрузки оборудования машины ${vehicle.id}:`,
							err,
						)
					}
				}),
			)

			setVehicleEquipmentMap(prev => ({
				...prev,
				...equipmentByVehicle,
			}))
		} catch (err) {
			console.error('Ошибка загрузки оборудования машин:', err)
		}
	}

	const fetchClientById = async clientId => {
		try {
			const res = await fetch(`${API_BASE_URL}/clients/${clientId}`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить клиента')
			}

			return await res.json()
		} catch (err) {
			console.error('Ошибка загрузки клиента по ID:', err)
			alert(err.message)
			return null
		}
	}

	const fetchClientGroupedPosition = async clientId => {
		try {
			const res = await fetch(
				`${API_BASE_URL}/clients/${clientId}/grouped-position?page_size=${clientGroupsPageSizeRef.current}`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось найти клиента в списке')
			}

			return await res.json()
		} catch (err) {
			console.error('Ошибка определения страницы клиента:', err)
			alert(err.message)
			return null
		}
	}

	const handleClientClick = async client => {
		if (!canOpenClientDetails(client)) {
			alert('У вас нет доступа к деталям этого клиента')
			return
		}

		const detailedClient = await fetchClientById(client.id)

		if (!detailedClient) {
			return
		}

		setSelectedClient({
			...client,
			...detailedClient,
		})

		setShowMonitoringPassword(false)
		setClientVehicles([])
		setVehiclesPage(1)
		setVehiclesTotal(0)
		setVehicleEquipmentMap({})
		setShowVehicles(false)
		setDeletedVehicles([])
		setShowDeletedVehicles(false)

		fetchClientRequests(client.id)
	}

	const fetchClientVehicles = async (
		clientId,
		silent = false,
		page = vehiclesPage,
		pageSize = vehiclesPageSize,
	) => {
		setIsVehiclesLoading(true)

		const offset = (page - 1) * pageSize

		try {
			const res = await fetch(
				`${API_BASE_URL}/vehicles?client_id=${clientId}&limit=${pageSize}&offset=${offset}`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (res.ok) {
				const data = await res.json()

				const items = Array.isArray(data) ? data : data.items || []
				const total = Array.isArray(data)
					? data.length
					: Number(data.total || 0)

				setClientVehicles(items)
				setVehiclesTotal(total)
				setVehiclesPage(page)
				setVehiclesPageSize(pageSize)

				fetchEquipmentForClientVehicles(items)

				if (items.length === 0 && total === 0 && !silent) {
					alert('У этого клиента пока нет добавленных автомобилей.')
				}
			}
		} catch (err) {
			console.error('Ошибка загрузки машин:', err)
		} finally {
			setIsVehiclesLoading(false)
		}
	}

	const openVehiclePageForHighlight = async (
		clientId,
		vehicleId,
		pageSize = vehiclesPageSize,
	) => {
		try {
			const res = await fetch(
				`${API_BASE_URL}/vehicles/${vehicleId}/page?limit=${pageSize}`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				console.error('Не удалось определить страницу машины')
				fetchClientVehicles(clientId, true, 1, pageSize)
				return
			}

			const data = await res.json()

			const nextPage = Number(data.page || 1)
			const nextPageSize = Number(data.limit || pageSize)

			fetchClientVehicles(clientId, true, nextPage, nextPageSize)
		} catch (err) {
			console.error('Ошибка определения страницы машины:', err)
			fetchClientVehicles(clientId, true, 1, pageSize)
		}
	}

	const handleVehiclesPageChange = nextPage => {
		if (!selectedClient) return

		fetchClientVehicles(selectedClient.id, true, nextPage, vehiclesPageSize)
	}

	const handleVehiclesPageSizeChange = nextPageSize => {
		if (!selectedClient) return

		fetchClientVehicles(selectedClient.id, true, 1, nextPageSize)
	}

	const fetchEquipmentForClientRequests = async requestsList => {
		try {
			const equipmentByVehicle = {}

			await Promise.all(
				requestsList.map(async req => {
					if (!req.id) return

					try {
						const res = await fetch(
							`${API_BASE_URL}/warehouse/requests/${req.id}/equipment`,
							{
								headers: getAuthHeaders(),
							},
						)

						if (!res.ok) return

						const equipment = await res.json()

						if (!Array.isArray(equipment) || equipment.length === 0) return

						equipment
							.filter(item => {
								if (!item.vehicle_id) return false
								if (item.warehouse_item_is_deleted) return false

								// В карточке авто клиента показываем только реально установленное оборудование.
								// Историческое оборудование из старых заявок после снятия не показываем.
								return item.status === 'INSTALLED'
							})
							.forEach(item => {
								if (!equipmentByVehicle[item.vehicle_id]) {
									equipmentByVehicle[item.vehicle_id] = []
								}

								const alreadyExists = equipmentByVehicle[item.vehicle_id].some(
									existing => existing.link_id === item.link_id,
								)

								if (!alreadyExists) {
									equipmentByVehicle[item.vehicle_id].push({
										...item,
										request_id: req.id,
										source_type: 'REQUEST',
										source_key: `REQUEST-${item.link_id}`,
									})
								}
							})
					} catch (err) {
						console.error(`Ошибка загрузки оборудования заявки ${req.id}:`, err)
					}
				}),
			)

			setVehicleEquipmentMap(prev => {
				const next = { ...prev }

				const vehicleIdsFromRequests = new Set()

				requestsList.forEach(req => {
					;(req.vehicles || []).forEach(vehicle => {
						if (vehicle.vehicle_id) {
							vehicleIdsFromRequests.add(String(vehicle.vehicle_id))
						}
					})
				})

				// Сначала убираем старые REQUEST-бейджи по машинам из заявок клиента.
				// Иначе снятое оборудование останется в state, даже если новый ответ его уже не вернул.
				vehicleIdsFromRequests.forEach(vehicleId => {
					const currentItems = next[vehicleId] || []

					next[vehicleId] = currentItems.filter(
						item => item.source_type === 'DIRECT',
					)
				})

				// Потом добавляем только актуальное request-оборудование со статусом INSTALLED.
				Object.entries(equipmentByVehicle).forEach(
					([vehicleId, requestEquipment]) => {
						const currentItems = next[vehicleId] || []
						const directItems = currentItems.filter(
							item => item.source_type === 'DIRECT',
						)

						next[vehicleId] = [...directItems, ...requestEquipment]
					},
				)

				return next
			})
		} catch (err) {
			console.error('Ошибка загрузки оборудования по машинам:', err)
		}
	}

	const handleDeleteClient = async (e, clientId, clientName) => {
		e?.stopPropagation?.()
		setActiveDropdown(null)

		if (!canDeleteClient) {
			alert('Недостаточно прав для удаления клиента')
			return
		}

		const confirmText =
			`Удалить клиента "${clientName}" в корзину?\n\n` +
			'Клиент будет скрыт из активного списка. Если у клиента есть активные заявки, backend не даст его удалить.'

		if (!window.confirm(confirmText)) {
			return
		}

		setClientActionLoading(true)

		try {
			const res = await fetch(`${API_BASE_URL}/clients/${clientId}`, {
				method: 'DELETE',
				headers: getAuthHeaders(),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Ошибка при удалении клиента')
			}

			alert(data?.message || 'Клиент перемещён в корзину')

			if (selectedClient && Number(selectedClient.id) === Number(clientId)) {
				setSelectedClient(null)
				setClientRequests([])
				setClientVehicles([])
				setVehicleEquipmentMap({})
				setShowVehicles(false)
				setDeletedVehicles([])
				setShowDeletedVehicles(false)
			}

			fetchClientGroups({
				initial: clientGroupsPageRef.current === 1,
				page: clientGroupsPageRef.current,
				pageSize: clientGroupsPageSizeRef.current,
			})

			fetchClients({ silent: true })
		} catch (err) {
			alert(`Ошибка при удалении: ${err.message}`)
		} finally {
			setClientActionLoading(false)
		}
	}

	const handleEditClientClick = async (e, client) => {
		e.stopPropagation()
		setActiveDropdown(null)

		const detailedClient = await fetchClientById(client.id)

		setEditClientData({
			...client,
			...(detailedClient || {}),
		})

		setCreateModalOpen(true)
	}

	const handleClientStatusChange = async nextStatus => {
		if (!selectedClient) return

		const oldStatus = selectedClient.status || 'ACTIVE'

		if (nextStatus === oldStatus) return

		const confirmText =
			nextStatus === 'BLOCKED'
				? 'Заблокировать клиента? После этого создавать заявки для него будет нельзя.'
				: nextStatus === 'DEBTOR'
					? 'Перевести клиента в статус должника? Заявки создавать можно, но будет предупреждение.'
					: 'Перевести клиента в статус активного?'

		if (!window.confirm(confirmText)) return

		setClientActionLoading(true)

		try {
			const res = await fetch(
				`${API_BASE_URL}/clients/${selectedClient.id}/status`,
				{
					method: 'PATCH',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({
						status: nextStatus,
					}),
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось изменить статус клиента')
			}

			const updatedClient = {
				...selectedClient,
				status: nextStatus,
			}

			updateClientLocally(updatedClient)
			fetchClientGroups({ silent: true })
		} catch (err) {
			alert(err.message)
		} finally {
			setClientActionLoading(false)
		}
	}

	const handleClientPaymentTypeChange = async nextPaymentType => {
		if (!selectedClient) return

		const oldPaymentType = selectedClient.payment_type || 'PREPAYMENT'

		if (nextPaymentType === oldPaymentType) return

		const confirmText =
			nextPaymentType === 'POSTPAYMENT'
				? 'Перевести клиента на постоплату? Неоплаченные заявки этого клиента будут видны монтажникам.'
				: 'Перевести клиента на предоплату? Новые и неоплаченные заявки будут скрыты от обычных монтажников до оплаты.'

		if (!window.confirm(confirmText)) return

		setClientActionLoading(true)

		try {
			const res = await fetch(
				`${API_BASE_URL}/clients/${selectedClient.id}/payment-type`,
				{
					method: 'PATCH',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({
						payment_type: nextPaymentType,
					}),
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(
					data?.detail || 'Не удалось изменить тип оплаты клиента',
				)
			}

			const updatedClient = {
				...selectedClient,
				payment_type: nextPaymentType,
			}

			updateClientLocally(updatedClient)
			fetchClientGroups({ silent: true })
			fetchClients({ silent: true })
		} catch (err) {
			alert(err.message)
		} finally {
			setClientActionLoading(false)
		}
	}

	const handleClientResponsibleChange = async value => {
		if (!selectedClient) return

		const nextResponsibleId = value ? Number(value) : null
		const currentResponsibleId = selectedClient.responsible_manager_id
			? Number(selectedClient.responsible_manager_id)
			: null

		if (nextResponsibleId === currentResponsibleId) return

		const responsible = responsibleManagers.find(
			user => Number(user.id) === Number(nextResponsibleId),
		)

		const responsibleName = responsible
			? `${responsible.name} (${responsible.role})`
			: 'без ответственного'

		const confirmText =
			`Назначить ответственного: ${responsibleName}?\n\n` +
			'Если у клиента есть подклиенты, они тоже будут переведены под этого ответственного.'

		if (!window.confirm(confirmText)) return

		setClientActionLoading(true)

		try {
			const res = await fetch(
				`${API_BASE_URL}/clients/${selectedClient.id}/responsible`,
				{
					method: 'PATCH',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({
						responsible_manager_id: nextResponsibleId,
						apply_to_subclients: true,
					}),
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось изменить ответственного')
			}

			const updatedClient = {
				...selectedClient,
				responsible_manager_id: nextResponsibleId,
				responsible_manager_name: responsible?.name || null,
			}

			updateClientLocally(updatedClient)
			fetchClientGroups({ silent: true })
		} catch (err) {
			alert(err.message)
		} finally {
			setClientActionLoading(false)
		}
	}

	const toggleDropdown = (e, clientId) => {
		e.stopPropagation()
		setActiveDropdown(prev => (prev === clientId ? null : clientId))
	}

	const toggleGroup = groupName => {
		setExpandedGroups(prev => ({
			...prev,
			[groupName]: !prev[groupName],
		}))
	}

	const toggleClientNode = clientId => {
		setExpandedClientNodes(prev => ({
			...prev,
			[clientId]: !prev[clientId],
		}))
	}

	const getEmptyVehicleForm = clientId => ({
		client_id: clientId,
		brand: '',
		model: '',
		plate_number: '',
		vin: '',
		year: '',
		type: '',
	})

	const openCreateVehicleModal = () => {
		if (!selectedClient) return

		if (!canAddVehicleToClient(selectedClient)) {
			alert('Недостаточно прав для добавления машины этому клиенту')
			return
		}

		setVehicleFormMode('create')
		setEditingVehicle(getEmptyVehicleForm(selectedClient.id))
	}

	const openEditVehicleModal = vehicle => {
		setVehicleFormMode('edit')
		setEditingVehicle(vehicle)
	}

	const closeVehicleModal = () => {
		setEditingVehicle(null)
		setVehicleFormMode('edit')
	}

	const handleVehicleSubmit = async e => {
		e.preventDefault()

		if (!editingVehicle || !selectedClient) return

		const isCreateMode = vehicleFormMode === 'create'

		const brand = String(editingVehicle.brand || '').trim()
		const model = String(editingVehicle.model || '').trim()
		const plateNumber = String(editingVehicle.plate_number || '').trim()
		const vin = String(editingVehicle.vin || '')
			.trim()
			.toUpperCase()
		const type = String(editingVehicle.type || '').trim()

		if (!brand) {
			alert('Укажите марку автомобиля')
			return
		}

		if (!model) {
			alert('Укажите модель автомобиля')
			return
		}

		if (!vin) {
			alert('Укажите VIN автомобиля')
			return
		}

		const yearValue = editingVehicle.year
			? parseInt(editingVehicle.year, 10)
			: null

		if (yearValue && (Number.isNaN(yearValue) || yearValue < 1900)) {
			alert('Некорректный год выпуска')
			return
		}

		setClientActionLoading(true)

		try {
			const payload = {
				brand,
				model,
				plate_number: plateNumber,
				vin,
				year: yearValue,
				type: type || null,
			}

			if (isCreateMode) {
				payload.client_id = Number(selectedClient.id)
			}

			const url = isCreateMode
				? `${API_BASE_URL}/vehicles`
				: `${API_BASE_URL}/vehicles/${editingVehicle.id}`

			const method = isCreateMode ? 'POST' : 'PATCH'

			const res = await fetch(url, {
				method,
				headers: getJsonAuthHeaders(),
				body: JSON.stringify(payload),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(
					data?.detail ||
						(isCreateMode
							? 'Не удалось добавить автомобиль'
							: 'Не удалось обновить автомобиль'),
				)
			}

			alert(
				isCreateMode
					? 'Автомобиль успешно добавлен клиенту'
					: 'Данные авто успешно обновлены!',
			)

			closeVehicleModal()

			setShowVehicles(true)
			setShowDeletedVehicles(false)

			fetchClientVehicles(
				selectedClient.id,
				true,
				isCreateMode ? 1 : vehiclesPage,
				vehiclesPageSize,
			)

			fetchClientGroups({ silent: true })
			fetchClients({ silent: true })
		} catch (err) {
			alert(`Ошибка: ${err.message}`)
		} finally {
			setClientActionLoading(false)
		}
	}

	const getVehicleDeleteReasonTypeLabel = type => {
		if (type === 'EQUIPMENT_REMOVED') {
			return 'Устройства сняты, машина удалена из GlonassSoft'
		}

		if (type === 'SERVICE_STOPPED_SIM_BLOCKED') {
			return 'Устройства остались, SIM заблокированы'
		}

		if (type === 'OTHER') {
			return 'Другое'
		}

		return type || '—'
	}

	const fetchDeletedVehicles = async clientId => {
		if (!clientId) return

		setDeletedVehiclesLoading(true)

		try {
			const res = await fetch(
				`${API_BASE_URL}/vehicles/deleted?client_id=${clientId}`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить корзину машин')
			}

			const data = await res.json()
			setDeletedVehicles(Array.isArray(data) ? data : [])
		} catch (err) {
			alert(err.message)
			setDeletedVehicles([])
		} finally {
			setDeletedVehiclesLoading(false)
		}
	}

	const openDeleteVehicleModal = vehicle => {
		setDeletingVehicle(vehicle)
		setDeleteVehicleForm({
			delete_reason_type: 'SERVICE_STOPPED_SIM_BLOCKED',
			delete_reason: '',
		})
	}

	const closeDeleteVehicleModal = () => {
		setDeletingVehicle(null)
		setDeleteVehicleForm({
			delete_reason_type: 'SERVICE_STOPPED_SIM_BLOCKED',
			delete_reason: '',
		})
	}

	const handleVehicleDeleteSubmit = async e => {
		e.preventDefault()

		if (!deletingVehicle) return

		if (!deleteVehicleForm.delete_reason_type) {
			alert('Выберите тип удаления')
			return
		}

		if (!deleteVehicleForm.delete_reason.trim()) {
			alert('Укажите причину удаления')
			return
		}

		const confirmText =
			`Удалить машину "${deletingVehicle.brand || ''} ${deletingVehicle.model || ''} ${deletingVehicle.plate_number || ''}" в корзину?\n\n` +
			`Тип: ${getVehicleDeleteReasonTypeLabel(deleteVehicleForm.delete_reason_type)}\n\n` +
			'Это не удалит старые заявки и не спишет оборудование. Машина просто исчезнет из активного списка.'

		if (!window.confirm(confirmText)) return

		setClientActionLoading(true)

		try {
			const res = await fetch(
				`${API_BASE_URL}/vehicles/${deletingVehicle.id}`,
				{
					method: 'DELETE',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({
						delete_reason_type: deleteVehicleForm.delete_reason_type,
						delete_reason: deleteVehicleForm.delete_reason.trim(),
					}),
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось удалить машину')
			}

			alert('Машина перемещена в корзину')

			closeDeleteVehicleModal()

			if (selectedClient) {
				fetchClientVehicles(
					selectedClient.id,
					true,
					vehiclesPage,
					vehiclesPageSize,
				)

				if (showDeletedVehicles) {
					fetchDeletedVehicles(selectedClient.id)
				}
			}

			fetchClientGroups({ silent: true })
			fetchClients({ silent: true })
		} catch (err) {
			alert(err.message)
		} finally {
			setClientActionLoading(false)
		}
	}

	const handleVehicleRestore = async vehicle => {
		if (!vehicle) return

		const confirmText =
			`Восстановить машину "${vehicle.brand || ''} ${vehicle.model || ''} ${vehicle.plate_number || ''}"?\n\n` +
			'Она снова появится в активном списке машин клиента.'

		if (!window.confirm(confirmText)) return

		setClientActionLoading(true)

		try {
			const res = await fetch(
				`${API_BASE_URL}/vehicles/${vehicle.id}/restore`,
				{
					method: 'PATCH',
					headers: getAuthHeaders(),
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось восстановить машину')
			}

			alert('Машина восстановлена')

			if (selectedClient) {
				fetchClientVehicles(
					selectedClient.id,
					true,
					vehiclesPage,
					vehiclesPageSize,
				)
				fetchDeletedVehicles(selectedClient.id)
			}

			fetchClientGroups({ silent: true })
			fetchClients({ silent: true })
		} catch (err) {
			alert(err.message)
		} finally {
			setClientActionLoading(false)
		}
	}

	const getVinHistoryClientName = vehicle => {
		if (!vehicle) return 'Клиент не указан'

		return (
			vehicle.client_company_name ||
			vehicle.company_name ||
			vehicle.client_name ||
			vehicle.name ||
			`ID клиента ${vehicle.client_id || '—'}`
		)
	}

	const getVinHistoryVehicleTitle = vehicle => {
		if (!vehicle) return 'Автомобиль не найден'

		const title =
			`${vehicle.brand || ''} ${vehicle.model || ''}`.trim() ||
			`Автомобиль ID ${vehicle.id || '—'}`

		const plate = vehicle.plate_number || 'б/н'

		return `${title} · ${plate}`
	}

	const fetchVehicleVinHistory = async vehicleId => {
		setVinHistoryLoading(true)
		setVinHistoryData(null)

		try {
			const res = await fetch(
				`${API_BASE_URL}/vehicles/${vehicleId}/vin-history`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить историю VIN')
			}

			const data = await res.json()
			setVinHistoryData(data)
		} catch (err) {
			alert(err.message)
			setVinHistoryData(null)
		} finally {
			setVinHistoryLoading(false)
		}
	}

	const openVinHistoryModal = vehicle => {
		setVinHistoryVehicle(vehicle)
		fetchVehicleVinHistory(vehicle.id)
	}

	const closeVinHistoryModal = () => {
		setVinHistoryVehicle(null)
		setVinHistoryData(null)
		setVinHistoryLoading(false)
	}

	const fetchVehicleTransferHistory = async vehicleId => {
		setTransferVehicleHistoryLoading(true)
		setTransferVehicleHistory([])

		try {
			const res = await fetch(
				`${API_BASE_URL}/vehicles/${vehicleId}/transfer-history`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить историю переноса')
			}

			const data = await res.json()
			setTransferVehicleHistory(Array.isArray(data) ? data : [])
		} catch (err) {
			console.error('Ошибка загрузки истории переноса машины:', err)
			setTransferVehicleHistory([])
		} finally {
			setTransferVehicleHistoryLoading(false)
		}
	}

	const openTransferVehicleModal = vehicle => {
		setTransferringVehicle(vehicle)
		setTransferVehicleForm({
			new_client_id: '',
			reason: '',
		})
		setTransferClientQuery('')
		fetchVehicleTransferHistory(vehicle.id)
	}

	const closeTransferVehicleModal = () => {
		setTransferringVehicle(null)
		setTransferVehicleForm({
			new_client_id: '',
			reason: '',
		})
		setTransferClientQuery('')
		setTransferVehicleHistory([])
	}

	const buildVehicleForAttachModal = vehicle => {
		if (!vehicle) return null

		return {
			...vehicle,
			client_name: selectedClient?.name || selectedClient?.client_name,
			company_name: selectedClient?.company_name,
			client_phone: selectedClient?.phone,
			client_bin_iin: selectedClient?.bin_iin,
			client_type: selectedClient?.type || selectedClient?.client_type,
		}
	}

	const openAttachEquipmentToVehicleModal = vehicle => {
		setAttachEquipmentVehicle(buildVehicleForAttachModal(vehicle))
	}

	const closeAttachEquipmentToVehicleModal = () => {
		setAttachEquipmentVehicle(null)
	}

	const handleDirectVehicleEquipmentAttached = () => {
		const vehicleId = attachEquipmentVehicle?.id

		setAttachEquipmentVehicle(null)

		if (vehicleId) {
			fetchEquipmentForClientVehicles([{ id: vehicleId }])
		}

		if (selectedClient) {
			fetchClientVehicles(
				selectedClient.id,
				true,
				vehiclesPage,
				vehiclesPageSize,
			)
			fetchClientGroups({ silent: true })
			fetchClients({ silent: true })
		}
	}

	const handleVehicleTransferSubmit = async e => {
		e.preventDefault()

		if (!transferringVehicle) return

		if (!transferVehicleForm.new_client_id) {
			alert('Выберите нового клиента')
			return
		}

		if (!transferVehicleForm.reason.trim()) {
			alert('Укажите причину переноса')
			return
		}

		const targetClient = clients.find(
			client => Number(client.id) === Number(transferVehicleForm.new_client_id),
		)

		const confirmText =
			`Перенести машину "${transferringVehicle.brand || ''} ${transferringVehicle.model || ''} ${transferringVehicle.plate_number || ''}" ` +
			`от клиента "${getClientDisplayName(selectedClient)}" ` +
			`к клиенту "${targetClient ? getClientDisplayName(targetClient) : `ID ${transferVehicleForm.new_client_id}`}"?\n\n` +
			'Старые заявки останутся у текущего клиента. Перенесётся только карточка машины.'

		if (!window.confirm(confirmText)) return

		setClientActionLoading(true)

		try {
			const res = await fetch(
				`${API_BASE_URL}/vehicles/${transferringVehicle.id}/transfer-client`,
				{
					method: 'POST',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({
						new_client_id: Number(transferVehicleForm.new_client_id),
						reason: transferVehicleForm.reason.trim(),
					}),
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось перенести машину')
			}

			alert('Машина успешно перенесена к другому клиенту')

			closeTransferVehicleModal()

			if (selectedClient) {
				fetchClientVehicles(
					selectedClient.id,
					true,
					vehiclesPage,
					vehiclesPageSize,
				)
				fetchClientRequests(selectedClient.id)
			}

			fetchClients({ silent: true })
			fetchClientGroups({ silent: true })
		} catch (err) {
			alert(err.message)
		} finally {
			setClientActionLoading(false)
		}
	}

	const statusLabels = {
		NEW: 'В ожидании',
		IN_PROGRESS: 'Принято в работу',
		COMPLETED: 'Работы завершены',
		CANCELLED: 'Отменено',
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

	const getPaginatedItems = (items, page, pageSize) => {
		const start = (page - 1) * pageSize
		return items.slice(start, start + pageSize)
	}

	const getTotalPages = (itemsCount, pageSize) => {
		return Math.max(1, Math.ceil(itemsCount / pageSize))
	}

	const renderPagination = ({
		page,
		pageSize,
		totalItems,
		onPageChange,
		onPageSizeChange,
	}) => {
		const totalPages = getTotalPages(totalItems, pageSize)

		return (
			<div className='pagination-bar'>
				<div className='pagination-size'>
					<span>Показывать:</span>

					<select
						value={pageSize}
						onChange={e => {
							onPageSizeChange(Number(e.target.value))
							onPageChange(1)
						}}
					>
						<option value={20}>20</option>
						<option value={30}>30</option>
						<option value={50}>50</option>
					</select>
				</div>

				<div className='pagination-info'>
					Страница {page} из {totalPages} · Всего: {totalItems}
				</div>

				<div className='pagination-actions'>
					<button
						className='btn-details'
						disabled={page <= 1}
						onClick={() => onPageChange(page - 1)}
					>
						Назад
					</button>

					<button
						className='btn-details'
						disabled={page >= totalPages}
						onClick={() => onPageChange(page + 1)}
					>
						Вперёд
					</button>
				</div>
			</div>
		)
	}

	const findClientInTree = (clientsList, targetClientId, ancestors = []) => {
		for (const client of clientsList || []) {
			const clientId = Number(client.id)

			if (clientId === Number(targetClientId)) {
				return {
					client,
					ancestorIds: ancestors,
				}
			}

			const childResult = findClientInTree(
				client.children || [],
				targetClientId,
				[...ancestors, clientId],
			)

			if (childResult) {
				return childResult
			}
		}

		return null
	}

	const findClientInGroups = targetClientId => {
		for (
			let groupIndex = 0;
			groupIndex < clientGroups.length;
			groupIndex += 1
		) {
			const group = clientGroups[groupIndex]

			if (
				group.parent_client &&
				Number(group.parent_client.id) === Number(targetClientId)
			) {
				return {
					group,
					groupIndex,
					isParentClient: true,
					client: group.parent_client,
					ancestorIds: [],
				}
			}

			const treeResult = findClientInTree(
				group.clients || [],
				targetClientId,
				[],
			)

			if (treeResult) {
				return {
					group,
					groupIndex,
					isParentClient: false,
					client: treeResult.client,
					ancestorIds: treeResult.ancestorIds,
				}
			}
		}

		return null
	}

	const renderClientCard = (client, level = 0) => {
		const children = Array.isArray(client?.children) ? client.children : []
		const childrenCount = getClientChildrenCount(client)
		const hasChildren = childrenCount > 0 || children.length > 0
		const hasLoadedChildren = children.length > 0
		const isExpanded = Boolean(expandedClientNodes[client.id])
		const isNested = level > 0
		const hierarchyBadgeText = getClientHierarchyBadgeText(client, level)

		if (isNested) {
			return (
				<div
					key={client.id}
					ref={el => {
						clientRefs.current[Number(client.id)] = el
					}}
					className={`client-tree-row-wrapper client-tree-row-wrapper-nested client-level-${Math.min(level, 4)} ${
						hasChildren
							? 'client-tree-row-wrapper-parent'
							: 'client-tree-row-wrapper-leaf'
					} ${
						Number(highlightedClientId) === Number(client.id)
							? 'client-highlighted'
							: ''
					} ${autoHighlightedClients[String(client.id)] || ''}`}
				>
					<div
						className={`client-tree-row ${hasChildren ? 'has-children' : 'is-leaf'}`}
					>
						<div className='client-tree-row-left'>
							<div className='client-tree-branch-line' />

							{hasChildren ? (
								<button
									type='button'
									className='client-node-toggle small'
									onClick={e => {
										e.stopPropagation()
										toggleClientNode(client.id)
									}}
									title={
										isExpanded ? 'Скрыть подклиентов' : 'Показать подклиентов'
									}
								>
									{isExpanded ? '▾' : '▸'}
								</button>
							) : (
								<span className='client-tree-dot' />
							)}

							<div className='client-tree-row-info'>
								<div className='client-tree-row-title'>
									<span className='client-tree-row-name'>
										{client.company_name || client.name}
									</span>

									{hierarchyBadgeText && (
										<span
											className={`client-hierarchy-badge ${
												hasChildren ? 'parent' : 'child'
											}`}
										>
											{hierarchyBadgeText}
										</span>
									)}
								</div>

								<div className='client-tree-row-meta'>
									{getClientTypeLabel(client.type)}
									{client.company_name ? ` · ${client.name}` : ''}
									{client.phone ? ` · ${client.phone}` : ''}
									{client.email ? ` · ${client.email}` : ''}
								</div>

								{renderClientBadges(client)}
							</div>
						</div>

						<div className='client-tree-row-right'>
							<span className='client-tree-stat'>
								Заявок: <b>{client.request_count || 0}</b>
							</span>

							<span className='client-tree-stat'>
								Машин:{' '}
								<b>
									{client.__countsUnknown ? '—' : client.vehicle_count || 0}
								</b>
							</span>

							{hasChildren && (
								<span className='client-tree-stat'>
									Подклиентов: <b>{client.children_count || children.length}</b>
								</span>
							)}

							{canOpenClientDetails(client) && (
								<button
									className='btn-details'
									onClick={e => {
										e.stopPropagation()
										handleClientClick(client)
									}}
								>
									Детали
								</button>
							)}

							{(canEditClient(client) || canDeleteClient) && (
								<div
									className='client-tree-actions'
									onClick={e => e.stopPropagation()}
								>
									<button
										type='button'
										className='client-tree-actions-btn'
										onClick={e => toggleDropdown(e, client.id)}
									>
										&#8942;
									</button>

									{activeDropdown === client.id && (
										<div className='client-tree-dropdown'>
											{canEditClient(client) && (
												<div
													className='client-tree-dropdown-item'
													onClick={e => handleEditClientClick(e, client)}
												>
													Редактировать
												</div>
											)}

											{canDeleteClient && (
												<div
													className='client-tree-dropdown-item danger'
													onClick={e =>
														handleDeleteClient(
															e,
															client.id,
															client.company_name || client.name,
														)
													}
												>
													Удалить
												</div>
											)}
										</div>
									)}
								</div>
							)}
						</div>
					</div>

					{hasLoadedChildren && isExpanded && (
						<div className='client-tree-children-list'>
							{children.map(child => renderClientCard(child, level + 1))}
						</div>
					)}
				</div>
			)
		}

		return (
			<div
				key={client.id}
				ref={el => {
					clientRefs.current[Number(client.id)] = el
				}}
				className={`client-tree-item ${
					Number(highlightedClientId) === Number(client.id)
						? 'client-highlighted'
						: ''
				} ${autoHighlightedClients[String(client.id)] || ''}`}
			>
				<div
					className={`client-card ${
						hasChildren ? 'client-card-parent' : 'client-card-standalone'
					} ${isExpanded ? 'client-card-expanded' : ''}`}
					style={{
						cursor: 'default',
						position: 'relative',
						zIndex: activeDropdown === client.id ? 100 : 1,
					}}
				>
					<div
						className='client-card-title'
						style={{
							display: 'flex',
							justifyContent: 'space-between',
							alignItems: 'flex-start',
							gap: '8px',
						}}
					>
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '8px',
								minWidth: 0,
							}}
						>
							{hasChildren && (
								<button
									type='button'
									className='client-node-toggle'
									onClick={e => {
										e.stopPropagation()
										toggleClientNode(client.id)
									}}
									title={
										isExpanded ? 'Скрыть подклиентов' : 'Показать подклиентов'
									}
								>
									{isExpanded ? '▾' : '▸'}
								</button>
							)}

							<span className='client-card-title-text'>
								{client.company_name || client.name}
							</span>

							{hierarchyBadgeText && (
								<span className='client-hierarchy-badge parent'>
									{hierarchyBadgeText}
								</span>
							)}
						</div>

						{(canEditClient(client) || canDeleteClient) && (
							<div
								className='card-actions-wrapper'
								style={{
									position: 'relative',
									marginTop: '-2px',
									marginRight: '-5px',
								}}
							>
								<div
									className='card-actions'
									style={{
										cursor: 'pointer',
										padding: '0 5px',
										fontSize: '20px',
										color: '#888',
										lineHeight: '1',
									}}
									onClick={e => toggleDropdown(e, client.id)}
								>
									&#8942;
								</div>

								{activeDropdown === client.id && (
									<div
										className='dropdown-menu'
										style={{
											position: 'absolute',
											right: 0,
											top: '25px',
											background: '#fff',
											border: '1px solid #eee',
											borderRadius: '6px',
											boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
											padding: '5px 0',
											minWidth: '150px',
											zIndex: 100,
										}}
									>
										{canEditClient(client) && (
											<div
												className='dropdown-item'
												style={{
													padding: '8px 15px',
													cursor: 'pointer',
													fontSize: '14px',
													borderBottom: canDeleteClient
														? '1px solid #f5f5f5'
														: 'none',
													color: '#333',
												}}
												onClick={e => handleEditClientClick(e, client)}
											>
												Редактировать
											</div>
										)}

										{canDeleteClient && (
											<div
												className='dropdown-item'
												style={{
													padding: '8px 15px',
													cursor: 'pointer',
													fontSize: '14px',
													color: '#c62828',
												}}
												onClick={e =>
													handleDeleteClient(
														e,
														client.id,
														client.company_name || client.name,
													)
												}
											>
												Удалить
											</div>
										)}
									</div>
								)}
							</div>
						)}
					</div>

					<div className='client-card-type'>
						{getClientTypeLabel(client.type)}
						{client.company_name ? ` · ${client.name}` : ''}
					</div>

					<div className='client-card-info'>
						{client.phone} {client.email ? ` · ${client.email}` : ''}
					</div>

					{renderClientBadges(client)}

					<div
						className='client-card-footer'
						style={{
							display: 'flex',
							justifyContent: 'space-between',
							alignItems: 'center',
							marginTop: '15px',
						}}
					>
						<div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
							<div>
								<span className='request-count-label'>Заявок:</span>
								<span
									className={`request-count-badge ${client.request_count > 0 ? 'active' : ''}`}
									style={{ marginLeft: '8px' }}
								>
									{client.request_count || 0}
								</span>
							</div>

							<div>
								<span className='request-count-label'>Машин:</span>
								<span
									className={`request-count-badge ${client.vehicle_count > 0 ? 'active' : ''}`}
									style={{ marginLeft: '8px' }}
								>
									{client.__countsUnknown ? '—' : client.vehicle_count || 0}
								</span>
							</div>

							{hasChildren && (
								<div className='client-children-stat'>
									<span className='request-count-label'>Подклиентов:</span>
									<span className='request-count-badge active client-children-count-badge'>
										{childrenCount}
									</span>
								</div>
							)}
						</div>

						{canOpenClientDetails(client) && (
							<button
								className='btn-details'
								onClick={e => {
									e.stopPropagation()
									handleClientClick(client)
								}}
							>
								Детали
							</button>
						)}
					</div>
				</div>

				{hasLoadedChildren && isExpanded && (
					<div className='client-tree-children-list root'>
						{children.map(child => renderClientCard(child, level + 1))}
					</div>
				)}
			</div>
		)
	}

	const filteredTransferClients = (clients || [])
		.filter(client => {
			if (!client || client.is_deleted) return false

			if (selectedClient && Number(client.id) === Number(selectedClient.id)) {
				return false
			}

			const q = transferClientQuery.trim().toLowerCase()

			if (!q) return true

			return [
				client.name,
				client.company_name,
				client.client_name,
				client.phone,
				client.email,
			]
				.filter(Boolean)
				.some(field => String(field).toLowerCase().includes(q))
		})
		.slice(0, 50)

	const paginatedClientGroups = clientGroups

	// Для бейджа на кнопке "Фильтры" на мобилке — pickerQuery это поиск/навигация,
	// а не фильтр, сужающий список, поэтому в счётчик не включаем.
	const activeFiltersCount = Object.values(clientFilters).filter(Boolean).length

	return (
		<div className='clients-page-container'>
			<style>{`
				@keyframes vehiclePulse {
					0%   { background: #fffde7; border-color: #f9a825; box-shadow: 0 0 0 4px rgba(249,168,37,0.25); }
					40%  { background: #fffde7; border-color: #f9a825; box-shadow: 0 0 0 4px rgba(249,168,37,0.25); }
					100% { background: transparent; border-color: #e0e0e0; box-shadow: none; }
				}
				.vehicle-highlighted {
					animation: vehiclePulse 2.5s ease-out forwards;
				}
			`}</style>
			{!selectedClient ? (
				<>
					<div className='clients-header-bar'>
						<h2>Клиенты</h2>
						<div className='clients-header-actions'>
							<span className='subtitle-text'>
								Клиенты из заявок и созданные вручную
							</span>
							{canCreateClient && (
								<button
									className='btn-green'
									onClick={() => {
										setEditClientData(null)
										setCreateModalOpen(true)
									}}
								>
									+ Добавить клиента
								</button>
							)}
						</div>
					</div>

					<button
						type='button'
						className='mobile-filters-toggle'
						onClick={() => setShowMobileFilters(prev => !prev)}
					>
						<span className='mobile-filters-toggle-label'>
							<i className='fa-solid fa-filter'></i>
							Фильтры
							{activeFiltersCount > 0 && (
								<span className='mobile-filters-badge'>
									{activeFiltersCount}
								</span>
							)}
						</span>
						<i
							className={`fa-solid fa-chevron-down mobile-filters-chevron ${
								showMobileFilters ? 'is-open' : ''
							}`}
						></i>
					</button>

					<div
						className={`filters-panel ${
							showMobileFilters ? 'mobile-open' : ''
						}`}
					>
						<div className='filters-bar clients-filters-bar'>
							<div
								className='filter-group filter-main client-picker'
								onClick={e => e.stopPropagation()}
							>
								<label>Найти клиента</label>
								<div className='client-search-field'>
									<input
										className={`filter-input ${pickerQuery ? 'filter-active' : ''}`}
										type='text'
										placeholder='ФИО, компания, телефон, email...'
										value={pickerQuery}
										onChange={e => setPickerQuery(e.target.value)}
									/>

									{pickerQuery && (
										<button
											type='button'
											className='client-search-clear'
											onClick={() => setPickerQuery('')}
											title='Очистить поиск'
										>
											×
										</button>
									)}
								</div>
							</div>

							<div className='filter-group'>
								<label>Статус клиента</label>
								<select
									className={`filter-select ${
										clientFilters.status ? 'filter-active' : ''
									}`}
									name='status'
									value={clientFilters.status}
									onChange={handleClientFilterChange}
								>
									<option value=''>Все статусы</option>
									<option value='ACTIVE'>Активный</option>
									<option value='DEBTOR'>Должник</option>
									<option value='BLOCKED'>Заблокирован</option>
								</select>
							</div>

							{canViewResponsibleFilter && (
								<div
									className='filter-group filter-typeahead'
									onClick={e => e.stopPropagation()}
								>
									<label>Ответственный</label>
									<input
										className={`filter-input ${
											clientFilters.responsible ? 'filter-active' : ''
										}`}
										type='text'
										placeholder='Введите имя...'
										value={responsibleQuery}
										onFocus={() => setIsResponsibleOpen(true)}
										onChange={handleResponsibleQueryChange}
									/>

									{isResponsibleOpen && (
										<div className='client-picker-dropdown'>
											{filteredResponsibleManagers.length === 0 ? (
												<div className='client-picker-empty'>
													Ничего не найдено
												</div>
											) : (
												filteredResponsibleManagers.map(manager => (
													<button
														key={manager.id}
														type='button'
														className='client-picker-option'
														onClick={() => handlePickResponsible(manager)}
													>
														<span className='client-picker-option-name'>
															{manager.name}
														</span>
														{manager.role && (
															<span className='client-picker-option-meta'>
																{manager.role}
															</span>
														)}
													</button>
												))
											)}
										</div>
									)}
								</div>
							)}

							<button className='btn-reset' onClick={resetClientFilters}>
								Сбросить
							</button>
						</div>
					</div>

					{loading ? (
						<div
							style={{ padding: '40px', textAlign: 'center', color: '#888' }}
						>
							Загрузка клиентов...
						</div>
					) : error ? (
						<div
							style={{ padding: '40px', textAlign: 'center', color: '#c53030' }}
						>
							{error}
						</div>
					) : isClientSearchActive ? (
						<div className='client-groups-list'>
							<div className='client-group-block'>
								<div className='client-group-header not-clickable client-group-parent'>
									<div className='client-group-main'>
										<div>
											<div className='client-group-title'>
												Результаты поиска
											</div>

											<div className='client-group-subtitle'>
												Найдено: {clientSearchResults.length} · запрос «
												{pickerQuery.trim()}»
											</div>
										</div>
									</div>

									<div className='client-group-actions'>
										<button
											type='button'
											className='btn-details'
											onClick={() => setPickerQuery('')}
										>
											Сбросить
										</button>
									</div>
								</div>

								<div className='client-group-tree-list'>
									{clientSearchResults.length === 0 ? (
										<div className='client-search-empty'>Ничего не найдено</div>
									) : (
										clientSearchResults.map(client =>
											renderClientCard(client, 0),
										)
									)}
								</div>
							</div>
						</div>
					) : clientGroups.length === 0 ? (
						<div
							style={{ padding: '40px', textAlign: 'center', color: '#888' }}
						>
							Загрузка клиентов...
						</div>
					) : (
						<>
							{renderPagination({
								page: clientGroupsPage,
								pageSize: clientGroupsPageSize,
								totalItems: clientGroupsTotal,
								onPageChange: setClientGroupsPage,
								onPageSizeChange: setClientGroupsPageSize,
							})}
							<div className='client-groups-list'>
								{paginatedClientGroups.map(group => {
									const hasSubclients =
										group.clients && group.clients.length > 0
									const isExpanded = Boolean(expandedGroups[group.group_name])

									return (
										<div key={group.group_name} className='client-group-block'>
											<div
												ref={el => {
													groupRefs.current[group.group_name] = el
												}}
												className={`client-group-header ${
													hasSubclients ? 'clickable' : 'not-clickable'
												} ${
													group.parent_client
														? 'client-group-parent'
														: 'client-group-standalone'
												} ${
													hasSubclients && isExpanded
														? 'client-group-expanded'
														: ''
												} ${
													highlightedGroupName === group.group_name
														? 'client-group-highlighted'
														: ''
												} ${
													group.parent_client
														? autoHighlightedClients[
																String(group.parent_client.id)
															] || ''
														: ''
												}`}
												onClick={() => {
													if (hasSubclients) {
														toggleGroup(group.group_name)
													}
												}}
											>
												<div className='client-group-main'>
													{hasSubclients && (
														<span className='client-group-arrow'>
															{isExpanded ? '▾' : '▸'}
														</span>
													)}

													<div>
														<div className='client-group-title client-group-title-with-badge'>
															<span>{group.group_name}</span>

															{group.parent_client &&
																Number(
																	group.subclients_count ||
																		group.parent_client.children_count ||
																		0,
																) > 0 && (
																	<span className='client-hierarchy-badge parent'>
																		Родитель ·{' '}
																		{Number(
																			group.subclients_count ||
																				group.parent_client.children_count ||
																				0,
																		)}{' '}
																		подкл.
																	</span>
																)}
														</div>

														<div className='client-group-subtitle'>
															{group.parent_client ? (
																<>
																	Подклиентов: {group.subclients_count || 0} ·
																	Машин: {group.vehicle_count || 0} · Заявок:{' '}
																	{group.request_count || 0}
																</>
															) : (
																<>
																	Клиентов: {group.clients_count || 0} · Машин:{' '}
																	{group.vehicle_count || 0} · Заявок:{' '}
																	{group.request_count || 0}
																</>
															)}
														</div>

														{group.parent_client &&
															renderClientBadges(group.parent_client)}
													</div>
												</div>

												<div className='client-group-actions'>
													{group.parent_client &&
														canOpenClientDetails(group.parent_client) && (
															<button
																className='btn-details'
																onClick={e => {
																	e.stopPropagation()
																	handleClientClick(group.parent_client)
																}}
															>
																Детали
															</button>
														)}

													{group.is_import_group && (
														<span className='client-group-badge'>
															GlonassSoft
														</span>
													)}
												</div>
											</div>

											{isExpanded &&
												group.clients &&
												group.clients.length > 0 && (
													<div className='client-group-tree-list'>
														{group.clients.map(client =>
															renderClientCard(client, 0),
														)}
													</div>
												)}
										</div>
									)
								})}
							</div>
							{renderPagination({
								page: clientGroupsPage,
								pageSize: clientGroupsPageSize,
								totalItems: clientGroupsTotal,
								onPageChange: setClientGroupsPage,
								onPageSizeChange: setClientGroupsPageSize,
							})}
						</>
					)}
				</>
			) : (
				<div className='client-detail-view'>
					<div className='clients-header-bar'>
						<div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
							<button
								className='btn-back'
								onClick={() => {
									setSelectedClient(null)
									setShowMonitoringPassword(false)
								}}
							>
								&larr; Назад
							</button>
							<h2>{selectedClient.company_name || selectedClient.name}</h2>
						</div>
					</div>

					<div className='client-info-box'>
						<div className='info-row'>
							<span className='info-key'>ФИО / Название</span>
							<span className='info-val'>
								{selectedClient.company_name || selectedClient.name}
							</span>
						</div>
						<div className='info-row'>
							<span className='info-key'>Тип лица</span>
							<span className='info-val'>
								{getClientTypeLabel(selectedClient.type)}
							</span>
						</div>
						<div className='info-row'>
							<span className='info-key'>
								{getClientIdentifierLabel(selectedClient)}
							</span>
							<span className='info-val'>
								{getClientIdentifierValue(selectedClient)}
							</span>
						</div>
						<div className='info-row'>
							<span className='info-key'>Телефон</span>
							<span className='info-val'>{selectedClient.phone}</span>
						</div>
						<div className='info-row'>
							<span className='info-key'>Email</span>
							<span className='info-val'>{selectedClient.email || '—'}</span>
						</div>
						<div className='info-row'>
							<span className='info-key'>Логин платформы мониторинга</span>
							<span className='info-val'>
								{selectedClient.monitoring_login || '—'}
							</span>
						</div>

						{canViewClientMonitoringPassword(selectedClient) && (
							<div className='info-row'>
								<span className='info-key'>Пароль платформы мониторинга</span>
								<span className='info-val'>
									{selectedClient.monitoring_password ? (
										<span
											style={{
												display: 'inline-flex',
												alignItems: 'center',
												gap: '8px',
												flexWrap: 'wrap',
											}}
										>
											<span>
												{showMonitoringPassword
													? selectedClient.monitoring_password
													: '••••••••'}
											</span>

											<button
												type='button'
												className='btn-details'
												onClick={() => setShowMonitoringPassword(prev => !prev)}
												style={{
													padding: '4px 8px',
													fontSize: '12px',
												}}
											>
												{showMonitoringPassword ? 'Скрыть' : 'Показать'}
											</button>
										</span>
									) : (
										'—'
									)}
								</span>
							</div>
						)}

						<div className='info-row'>
							<span className='info-key'>Статус клиента</span>

							{canChangeClientStatus(selectedClient) ? (
								<div className='client-status-control'>
									<span
										className={`client-status-dot client-status-dot-${String(selectedClient.status || 'ACTIVE').toLowerCase()}`}
									/>

									<select
										className='client-inline-select client-status-select'
										value={selectedClient.status || 'ACTIVE'}
										onChange={e => handleClientStatusChange(e.target.value)}
										disabled={clientActionLoading}
									>
										<option value='ACTIVE'>Активный</option>
										<option value='DEBTOR'>Должник</option>
										<option value='BLOCKED'>Заблокирован</option>
									</select>
								</div>
							) : (
								<span
									className={`info-val client-status-detail client-status-${String(selectedClient.status || 'ACTIVE').toLowerCase()}`}
								>
									{getClientStatusLabel(selectedClient.status || 'ACTIVE')}
								</span>
							)}
						</div>

						<div className='info-row'>
							<span className='info-key'>Тип оплаты</span>

							{canChangeClientPaymentType(selectedClient) ? (
								<div className='client-status-control'>
									<span
										className={`client-payment-dot client-payment-dot-${getClientPaymentTypeClass(
											selectedClient.payment_type || 'PREPAYMENT',
										)}`}
									/>

									<select
										className='client-inline-select client-payment-select'
										value={selectedClient.payment_type || 'PREPAYMENT'}
										onChange={e =>
											handleClientPaymentTypeChange(e.target.value)
										}
										disabled={clientActionLoading}
									>
										<option value='PREPAYMENT'>Предоплата</option>
										<option value='POSTPAYMENT'>Постоплата</option>
									</select>
								</div>
							) : (
								<span
									className={`info-val client-payment-detail client-payment-${getClientPaymentTypeClass(
										selectedClient.payment_type || 'PREPAYMENT',
									)}`}
								>
									{getClientPaymentTypeLabel(
										selectedClient.payment_type || 'PREPAYMENT',
									)}
								</span>
							)}
						</div>

						<div className='info-row'>
							<span className='info-key'>Ответственный</span>

							{canReassignClient(selectedClient) ? (
								<select
									className='client-inline-select'
									value={selectedClient.responsible_manager_id || ''}
									onChange={e => handleClientResponsibleChange(e.target.value)}
									disabled={clientActionLoading}
								>
									<option value=''>Не назначен</option>

									{responsibleManagers.map(user => (
										<option key={user.id} value={user.id}>
											{user.name} ·{' '}
											{user.role === 'MANAGER'
												? 'Менеджер'
												: user.role === 'ROP'
													? 'РОП'
													: user.role === 'ADMIN'
														? 'Админ'
														: user.role}
										</option>
									))}
								</select>
							) : (
								<span className='info-val'>
									{selectedClient.responsible_manager_name || 'Не назначен'}
								</span>
							)}
						</div>

						{(canEditClient(selectedClient) || canDeleteClient) && (
							<div className='client-edit-btn-wrapper'>
								{canEditClient(selectedClient) && (
									<button
										className='btn-edit-request client-detail-action-btn'
										onClick={e => handleEditClientClick(e, selectedClient)}
										disabled={clientActionLoading}
									>
										✎ Редактировать
									</button>
								)}

								{canDeleteClient && (
									<button
										className='btn-delete-client-detail client-detail-action-btn'
										onClick={e =>
											handleDeleteClient(
												e,
												selectedClient.id,
												selectedClient.company_name || selectedClient.name,
											)
										}
										disabled={clientActionLoading}
									>
										🗑 Удалить клиента
									</button>
								)}
							</div>
						)}

						<div>
							<div className='client-vehicle-toolbar'>
								<div className='client-vehicle-toolbar-left'>
									{canViewVehiclesForClient(selectedClient) && (
										<button
											className='btn-green client-vehicle-toolbar-btn'
											onClick={() => {
												if (showVehicles) {
													setShowVehicles(false)
												} else {
													setShowDeletedVehicles(false)
													setShowVehicles(true)
													fetchClientVehicles(
														selectedClient.id,
														false,
														vehiclesPage,
														vehiclesPageSize,
													)
												}
											}}
											disabled={isVehiclesLoading}
										>
											{isVehiclesLoading
												? 'Загрузка...'
												: showVehicles
													? '🚗 Скрыть машины клиента'
													: '🚗 Просмотреть все машины клиента'}
										</button>
									)}

									{canViewVehicleTrash &&
										canViewVehiclesForClient(selectedClient) && (
											<button
												className='btn-details client-vehicle-toolbar-btn'
												onClick={() => {
													if (showDeletedVehicles) {
														setShowDeletedVehicles(false)
													} else {
														setShowVehicles(false)
														setShowDeletedVehicles(true)
														fetchDeletedVehicles(selectedClient.id)
													}
												}}
												disabled={deletedVehiclesLoading}
											>
												{deletedVehiclesLoading
													? 'Загрузка...'
													: showDeletedVehicles
														? '🗑 Скрыть корзину машин'
														: '🗑 Корзина машин'}
											</button>
										)}
								</div>

								<div className='client-vehicle-toolbar-right'>
									{canAddVehicleToClient(selectedClient) && (
										<button
											className='btn-green vehicle-create-btn'
											onClick={openCreateVehicleModal}
											disabled={clientActionLoading}
										>
											+ Добавить авто
										</button>
									)}
								</div>
							</div>

							{/* БЛОК ВЫВОДА МАШИН С КНОПКОЙ ИЗМЕНИТЬ */}
							{showVehicles && clientVehicles.length > 0 && (
								<div
									style={{
										marginTop: '15px',
										background: '#f8f9fa',
										border: '1px solid #e0e0e0',
										borderRadius: '8px',
										padding: '15px',
									}}
								>
									<h4
										style={{
											margin: '0 0 10px 0',
											fontSize: '14px',
											color: '#333',
										}}
									>
										Транспорт клиента ({vehiclesTotal || clientVehicles.length}
										):
									</h4>

									{renderPagination({
										page: vehiclesPage,
										pageSize: vehiclesPageSize,
										totalItems: vehiclesTotal,
										onPageChange: handleVehiclesPageChange,
										onPageSizeChange: handleVehiclesPageSizeChange,
									})}

									<div style={{ display: 'grid', gap: '10px' }}>
										{clientVehicles.map(v => (
											<div
												key={v.id}
												ref={el => {
													vehicleRefs.current[Number(v.id)] = el
												}}
												className={`vehicle-card${Number(highlightedVehicleId) === Number(v.id) ? ' vehicle-highlighted' : ''}`}
											>
												<div className='vehicle-card-main'>
													<div className='vehicle-card-header'>
														<strong className='vehicle-card-title'>
															{v.brand} {v.model}
														</strong>

														<div className='vehicle-equipment-badges'>
															{getVehicleEquipment(v.id).length > 0 ? (
																getVehicleEquipment(v.id).map(item => (
																	<span
																		key={getEquipmentBadgeKey(item)}
																		className='vehicle-equipment-badge'
																	>
																		{getEquipmentBadgeText(item)}
																	</span>
																))
															) : (
																<span className='vehicle-equipment-badge empty'>
																	Устройства не привязаны
																</span>
															)}
														</div>
													</div>

													<div className='vehicle-card-meta'>
														Гос. номер: {v.plate_number || 'б/н'} • VIN:{' '}
														{v.vin || '—'} • Год: {v.year || '—'}
													</div>
												</div>

												{(v.vin ||
													canEditVehicleForClient(selectedClient) ||
													canTransferVehicle ||
													canManageDirectVehicleEquipment) && (
													<div className='vehicle-card-actions'>
														{canManageDirectVehicleEquipment && (
															<button
																className='btn-details vehicle-attach-equipment-btn'
																onClick={() =>
																	openAttachEquipmentToVehicleModal(v)
																}
															>
																+ Оборудование
															</button>
														)}
														{v.vin && (
															<button
																className='btn-details vehicle-vin-history-btn'
																onClick={() => openVinHistoryModal(v)}
															>
																История VIN
															</button>
														)}
														{canEditVehicleForClient(selectedClient) && (
															<button
																className='btn-details vehicle-edit-btn'
																onClick={() => openEditVehicleModal(v)}
															>
																✎ Изменить
															</button>
														)}

														{canTransferVehicle && (
															<button
																className='btn-details vehicle-transfer-btn'
																onClick={() => openTransferVehicleModal(v)}
															>
																⇄ Перенести
															</button>
														)}

														{canSoftDeleteVehicle && (
															<button
																className='btn-details vehicle-delete-btn'
																onClick={() => openDeleteVehicleModal(v)}
															>
																🗑 Удалить
															</button>
														)}
													</div>
												)}
											</div>
										))}
									</div>

									{renderPagination({
										page: vehiclesPage,
										pageSize: vehiclesPageSize,
										totalItems: vehiclesTotal,
										onPageChange: handleVehiclesPageChange,
										onPageSizeChange: handleVehiclesPageSizeChange,
									})}
								</div>
							)}

							{showDeletedVehicles && (
								<div
									className='vehicle-trash-box'
									style={{
										marginTop: '15px',
										background: '#fff8f8',
										border: '1px solid #ffcdd2',
										borderRadius: '8px',
										padding: '15px',
									}}
								>
									<h4
										style={{
											margin: '0 0 10px 0',
											fontSize: '14px',
											color: '#c62828',
										}}
									>
										Корзина машин клиента ({deletedVehicles.length})
									</h4>

									{deletedVehiclesLoading ? (
										<div style={{ color: '#888', padding: '15px 0' }}>
											Загрузка корзины...
										</div>
									) : deletedVehicles.length === 0 ? (
										<div style={{ color: '#888', padding: '15px 0' }}>
											В корзине нет машин этого клиента
										</div>
									) : (
										<div style={{ display: 'grid', gap: '10px' }}>
											{deletedVehicles.map(vehicle => (
												<div
													key={vehicle.id}
													ref={el => {
														vehicleRefs.current[Number(vehicle.id)] = el
													}}
													className={`vehicle-trash-card${
														Number(highlightedVehicleId) === Number(vehicle.id)
															? ' vehicle-highlighted'
															: ''
													}`}
												>
													<div className='vehicle-card-main'>
														<div className='vehicle-card-header'>
															<strong className='vehicle-card-title'>
																{vehicle.brand} {vehicle.model}
															</strong>
														</div>

														<div className='vehicle-card-meta'>
															Гос. номер: {vehicle.plate_number || 'б/н'} • VIN:{' '}
															{vehicle.vin || '—'} • Год: {vehicle.year || '—'}
														</div>

														<div className='vehicle-card-meta'>
															Удалил: {vehicle.deleted_by_name || '—'} •{' '}
															{vehicle.deleted_at
																? new Date(vehicle.deleted_at).toLocaleString(
																		'ru-RU',
																	)
																: 'Дата не указана'}
														</div>

														<div className='vehicle-delete-reason-box'>
															<strong>
																{getVehicleDeleteReasonTypeLabel(
																	vehicle.delete_reason_type,
																)}
															</strong>
															<span>
																Комментарий:{' '}
																{vehicle.delete_reason || 'Причина не указана'}
															</span>
														</div>

														{Number(vehicle.request_count || 0) > 0 && (
															<div className='vehicle-card-meta'>
																Исторических заявок: {vehicle.request_count}
															</div>
														)}
													</div>

													{canRestoreVehicle && (
														<button
															className='btn-details vehicle-restore-btn'
															onClick={() => handleVehicleRestore(vehicle)}
															disabled={clientActionLoading}
														>
															↩ Восстановить
														</button>
													)}
												</div>
											))}
										</div>
									)}
								</div>
							)}
						</div>
					</div>

					<div className='client-files-section'>
						<AttachmentsPanel
							entityType='CLIENT'
							entityId={selectedClient.id}
						/>
					</div>

					<h3 className='section-title' style={{ marginTop: '30px' }}>
						Заявки клиента ({clientRequests.length})
					</h3>

					<div className='requests-list' style={{ marginTop: '15px' }}>
						{clientRequests.length === 0 ? (
							<div
								style={{
									textAlign: 'center',
									color: '#888',
									marginTop: '20px',
								}}
							>
								Нет заявок
							</div>
						) : null}

						{clientRequests.map(req => (
							<div
								key={req.id}
								className='request-card'
								style={{ position: 'relative', cursor: 'default' }}
							>
								<div className='card-column'>
									<div className='card-item' style={{ marginTop: '8px' }}>
										<span className='card-label'>Вид работы</span>
										<span
											style={{
												fontSize: '15px',
												fontWeight: '600',
												color: getWorkTypeColor(req.work_type),
											}}
										>
											{getWorkTypeLabel(req.work_type)}
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

									<div className='card-item' style={{ marginTop: '5px' }}>
										<span className='card-label'>
											{getRequestExecutors(req).length > 1
												? 'Исполнители'
												: 'Исполнитель'}
										</span>

										<span
											className='card-value'
											style={{
												fontWeight: '600',
												color: '#5e9424',
												fontSize: '13px',
												lineHeight: '1.35',
											}}
										>
											{getRequestExecutorsLabel(req)}
										</span>
									</div>
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
										<span className='card-value'>
											{req.city || 'Не указан'}
										</span>
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
										<span className='card-value'>
											{formatDate(req.created_at)}
										</span>
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
										<div className='card-item'>
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
													className={`payment-status ${
														(req.client_payment_type ||
															selectedClient?.payment_type) === 'POSTPAYMENT'
															? Boolean(req.is_paid)
																? 'payment-postpaid-paid'
																: 'payment-postpaid-unpaid'
															: Boolean(req.is_paid)
																? 'payment-paid'
																: 'payment-unpaid'
													}`}
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
											setSelectedRequestId(req.id)
										}}
									>
										Детали
									</button>
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* МОДАЛКА СОЗДАНИЯ / РЕДАКТИРОВАНИЯ АВТОМОБИЛЯ */}
			{editingVehicle && (
				<div className='modal-overlay open' onClick={closeVehicleModal}>
					<div
						className='modal-window vehicle-modal-window'
						onClick={e => e.stopPropagation()}
					>
						<div className='modal-header'>
							<span className='modal-title'>
								{vehicleFormMode === 'create'
									? 'Добавить авто клиенту'
									: 'Редактирование авто'}
							</span>

							<button
								className='modal-close'
								onClick={closeVehicleModal}
								type='button'
							>
								&times;
							</button>
						</div>

						<div className='vehicle-modal-body'>
							<form onSubmit={handleVehicleSubmit} id='vehicle-form'>
								<div className='vehicle-form-card'>
									<div className='vehicle-form-section-title'>
										Основная информация
									</div>

									{vehicleFormMode === 'create' && (
										<div className='vehicle-transfer-warning'>
											Автомобиль будет добавлен напрямую к клиенту без создания
											заявки.
										</div>
									)}

									<div className='vehicle-form-grid'>
										<label className='vehicle-field'>
											<span className='vehicle-label required'>Марка</span>
											<input
												className='vehicle-input'
												value={editingVehicle.brand || ''}
												onChange={e =>
													setEditingVehicle({
														...editingVehicle,
														brand: e.target.value,
													})
												}
												required
											/>
										</label>

										<label className='vehicle-field'>
											<span className='vehicle-label required'>Модель</span>
											<input
												className='vehicle-input'
												value={editingVehicle.model || ''}
												onChange={e =>
													setEditingVehicle({
														...editingVehicle,
														model: e.target.value,
													})
												}
												required
											/>
										</label>

										<label className='vehicle-field'>
											<span className='vehicle-label'>Гос. номер</span>
											<input
												className='vehicle-input'
												value={editingVehicle.plate_number || ''}
												onChange={e =>
													setEditingVehicle({
														...editingVehicle,
														plate_number: e.target.value,
													})
												}
												placeholder='Например: 123ABC02'
											/>
										</label>

										<label className='vehicle-field'>
											<span className='vehicle-label'>Год выпуска</span>
											<input
												className='vehicle-input'
												type='number'
												min='1900'
												max='2100'
												value={editingVehicle.year || ''}
												onChange={e =>
													setEditingVehicle({
														...editingVehicle,
														year: e.target.value,
													})
												}
											/>
										</label>

										<label className='vehicle-field vehicle-full'>
											<span className='vehicle-label required'>VIN-код</span>
											<input
												className='vehicle-input'
												maxLength='17'
												value={editingVehicle.vin || ''}
												onChange={e =>
													setEditingVehicle({
														...editingVehicle,
														vin: e.target.value.toUpperCase(),
													})
												}
												placeholder='VIN обязателен'
												required
											/>
										</label>
									</div>
								</div>

								{vehicleFormMode !== 'create' && (
									<div className='vehicle-form-card'>
										<div className='vehicle-form-section-title'>
											Привязанное оборудование
										</div>

										<div className='vehicle-equipment-badges modal-equipment-badges'>
											{getVehicleEquipment(editingVehicle.id).length > 0 ? (
												getVehicleEquipment(editingVehicle.id).map(item => (
													<span
														key={getEquipmentBadgeKey(item)}
														className='vehicle-equipment-badge'
													>
														{getEquipmentBadgeText(item)}
													</span>
												))
											) : (
												<span className='vehicle-equipment-badge empty'>
													Устройства не привязаны
												</span>
											)}
										</div>

										<div className='vehicle-equipment-hint'>
											Устройства могут быть привязаны через заявку или напрямую
											со склада.
										</div>

										{canManageDirectVehicleEquipment && (
											<button
												type='button'
												className='btn-details vehicle-attach-equipment-btn'
												onClick={() => {
													const vehicleToAttach = editingVehicle
													closeVehicleModal()
													openAttachEquipmentToVehicleModal(vehicleToAttach)
												}}
											>
												+ Привязать оборудование
											</button>
										)}
									</div>
								)}
							</form>
						</div>

						<div className='modal-footer vehicle-modal-footer'>
							<button
								className='vehicle-cancel-btn'
								type='button'
								onClick={closeVehicleModal}
								disabled={clientActionLoading}
							>
								Отмена
							</button>

							<button
								className='vehicle-submit-btn'
								type='submit'
								form='vehicle-form'
								disabled={clientActionLoading}
							>
								{clientActionLoading
									? vehicleFormMode === 'create'
										? 'Добавление...'
										: 'Сохранение...'
									: vehicleFormMode === 'create'
										? 'Добавить авто'
										: 'Сохранить'}
							</button>
						</div>
					</div>
				</div>
			)}

			{transferringVehicle && (
				<div className='modal-overlay open' onClick={closeTransferVehicleModal}>
					<div
						className='modal-window vehicle-modal-window'
						onClick={e => e.stopPropagation()}
					>
						<div className='modal-header'>
							<span className='modal-title'>
								Перенос машины к другому клиенту
							</span>
							<button
								className='modal-close'
								onClick={closeTransferVehicleModal}
								type='button'
							>
								&times;
							</button>
						</div>

						<div className='vehicle-modal-body'>
							<form
								onSubmit={handleVehicleTransferSubmit}
								id='vehicle-transfer-form'
							>
								<div className='vehicle-form-card'>
									<div className='vehicle-form-section-title'>Машина</div>

									<div className='vehicle-transfer-summary'>
										<div>
											<strong>
												{transferringVehicle.brand} {transferringVehicle.model}
											</strong>
											<span>
												<br />
												Гос. номер: {transferringVehicle.plate_number ||
													'б/н'}{' '}
												<br />
												VIN: {transferringVehicle.vin || '—'}
											</span>
										</div>

										<div>
											<strong>
												<br />
												Текущий клиент:{' '}
											</strong>
											<span>{getClientDisplayName(selectedClient)}</span>
										</div>
									</div>

									<div className='vehicle-transfer-warning'>
										<br />
										Переносится только карточка машины. Старые заявки и
										привязанное к ним оборудование останутся в истории текущего
										клиента.
									</div>
								</div>

								<div className='vehicle-form-card'>
									<div className='vehicle-form-section-title'>Новый клиент</div>

									<div className='vehicle-form-grid'>
										<label className='vehicle-field vehicle-full'>
											<span className='vehicle-label'>Поиск клиента</span>
											<input
												className='vehicle-input'
												value={transferClientQuery}
												onChange={e => setTransferClientQuery(e.target.value)}
												placeholder='ФИО, компания, телефон, email...'
											/>
										</label>

										<label className='vehicle-field vehicle-full'>
											<span className='vehicle-label required'>
												Выберите клиента
											</span>
											<select
												className='vehicle-input'
												value={transferVehicleForm.new_client_id}
												onChange={e =>
													setTransferVehicleForm(prev => ({
														...prev,
														new_client_id: e.target.value,
													}))
												}
												required
											>
												<option value=''>— выберите нового клиента —</option>

												{filteredTransferClients.map(client => (
													<option key={client.id} value={client.id}>
														{getClientDisplayName(client)}
														{client.phone ? ` · ${client.phone}` : ''}
													</option>
												))}
											</select>
										</label>

										<label className='vehicle-field vehicle-full'>
											<span className='vehicle-label required'>
												Причина переноса
											</span>
											<textarea
												className='vehicle-input vehicle-transfer-textarea'
												value={transferVehicleForm.reason}
												onChange={e =>
													setTransferVehicleForm(prev => ({
														...prev,
														reason: e.target.value,
													}))
												}
												placeholder='Например: автомобиль продан другому клиенту / переоформление / ошибка привязки'
												required
											/>
										</label>
									</div>
								</div>

								<div className='vehicle-form-card'>
									<div className='vehicle-form-section-title'>
										История переносов
									</div>

									{transferVehicleHistoryLoading ? (
										<div className='vehicle-transfer-empty'>
											Загрузка истории...
										</div>
									) : transferVehicleHistory.length === 0 ? (
										<div className='vehicle-transfer-empty'>
											Истории переносов пока нет
										</div>
									) : (
										<div className='vehicle-transfer-history-list'>
											{transferVehicleHistory.map(row => (
												<div
													key={row.id}
													className='vehicle-transfer-history-row'
												>
													<div>
														<strong>
															{row.old_client_display_name || row.old_client_id}{' '}
															→{' '}
															{row.new_client_display_name || row.new_client_id}
														</strong>
														<span>
															<br />
															Комментарий: {row.reason}
														</span>
													</div>

													<div className='vehicle-transfer-history-meta'>
														<span>Перенес: {row.created_by_name || '—'}</span>
														<span>
															<br />
															{row.created_at
																? new Date(row.created_at).toLocaleString(
																		'ru-RU',
																	)
																: 'Дата не указана'}
															<br />
															<br />
														</span>
													</div>
												</div>
											))}
										</div>
									)}
								</div>
							</form>
						</div>

						<div className='modal-footer vehicle-modal-footer'>
							<button
								className='vehicle-cancel-btn'
								type='button'
								onClick={closeTransferVehicleModal}
							>
								Отмена
							</button>

							<button
								className='vehicle-submit-btn'
								type='submit'
								form='vehicle-transfer-form'
								disabled={
									clientActionLoading ||
									!transferVehicleForm.new_client_id ||
									!transferVehicleForm.reason.trim()
								}
							>
								{clientActionLoading ? 'Перенос...' : 'Перенести машину'}
							</button>
						</div>
					</div>
				</div>
			)}

			{deletingVehicle && (
				<div className='modal-overlay open' onClick={closeDeleteVehicleModal}>
					<div
						className='modal-window vehicle-modal-window'
						onClick={e => e.stopPropagation()}
					>
						<div className='modal-header'>
							<span className='modal-title'>Удаление машины в корзину</span>
							<button
								className='modal-close'
								onClick={closeDeleteVehicleModal}
								type='button'
							>
								&times;
							</button>
						</div>

						<form onSubmit={handleVehicleDeleteSubmit}>
							<div className='vehicle-modal-body'>
								<div className='vehicle-form-card'>
									<div className='vehicle-form-section-title'>Машина</div>

									<div className='vehicle-transfer-summary'>
										<div>
											<strong>
												{deletingVehicle.brand} {deletingVehicle.model}
											</strong>
											<span>
												<br />
												Гос. номер: {deletingVehicle.plate_number || 'б/н'}
												<br />
												VIN: {deletingVehicle.vin || '—'}
											</span>
										</div>

										<div>
											<strong>
												<br />
												Клиент:{' '}
											</strong>
											<span>
												{getClientDisplayName(selectedClient)} <br />
												<br />
											</span>
										</div>
									</div>

									<div className='vehicle-transfer-warning danger'>
										Машина будет скрыта из активного списка клиента. Старые
										заявки и история оборудования не удаляются.
									</div>
								</div>

								<div className='vehicle-form-card'>
									<div className='vehicle-form-section-title'>
										Причина удаления
									</div>

									<div className='vehicle-form-grid'>
										<label className='vehicle-field vehicle-full'>
											<span className='vehicle-label required'>
												Тип удаления
											</span>
											<select
												className='vehicle-input'
												value={deleteVehicleForm.delete_reason_type}
												onChange={e =>
													setDeleteVehicleForm(prev => ({
														...prev,
														delete_reason_type: e.target.value,
													}))
												}
												required
											>
												<option value='EQUIPMENT_REMOVED'>
													Устройства сняты, машина удалена из GlonassSoft
												</option>
												<option value='SERVICE_STOPPED_SIM_BLOCKED'>
													Устройства остались, SIM заблокированы
												</option>
												<option value='OTHER'>Другое</option>
											</select>
										</label>

										<label className='vehicle-field vehicle-full'>
											<span className='vehicle-label required'>
												Комментарий
											</span>
											<textarea
												className='vehicle-input vehicle-transfer-textarea'
												value={deleteVehicleForm.delete_reason}
												onChange={e =>
													setDeleteVehicleForm(prev => ({
														...prev,
														delete_reason: e.target.value,
													}))
												}
												placeholder='Например: устройство демонтировано / SIM заблокирована / клиент больше не обслуживается'
												required
											/>
										</label>
									</div>
								</div>
							</div>

							<div className='modal-footer vehicle-modal-footer'>
								<button
									className='vehicle-cancel-btn'
									type='button'
									onClick={closeDeleteVehicleModal}
								>
									Отмена
								</button>

								<button
									className='vehicle-submit-btn danger'
									type='submit'
									disabled={
										clientActionLoading ||
										!deleteVehicleForm.delete_reason_type ||
										!deleteVehicleForm.delete_reason.trim()
									}
								>
									{clientActionLoading ? 'Удаление...' : 'Удалить в корзину'}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{vinHistoryVehicle && (
				<div className='modal-overlay open' onClick={closeVinHistoryModal}>
					<div
						className='modal-window vehicle-modal-window vin-history-modal-window'
						onClick={e => e.stopPropagation()}
					>
						<div className='modal-header'>
							<span className='modal-title'>История VIN</span>

							<button
								className='modal-close'
								onClick={closeVinHistoryModal}
								type='button'
							>
								&times;
							</button>
						</div>

						<div className='vehicle-modal-body'>
							<div className='vehicle-form-card'>
								<div className='vehicle-form-section-title'>Текущая машина</div>

								<div className='vin-history-current-card'>
									<strong>
										{vinHistoryVehicle.brand} {vinHistoryVehicle.model}
									</strong>

									<span>
										VIN: {vinHistoryVehicle.vin || '—'}
										<br />
										Гос. номер: {vinHistoryVehicle.plate_number || 'б/н'}
									</span>

									<span>Клиент: {getClientDisplayName(selectedClient)}</span>
								</div>
							</div>

							{vinHistoryLoading ? (
								<div className='vehicle-form-card'>
									<div className='vin-history-empty'>
										Загрузка истории VIN...
									</div>
								</div>
							) : (
								<>
									<div className='vehicle-form-card'>
										<div className='vehicle-form-section-title'>
											История машины с этим VIN
										</div>

										{!vinHistoryData?.related_vehicles ||
										vinHistoryData.related_vehicles.length === 0 ? (
											<div className='vin-history-empty'>
												Других машин с этим VIN не найдено.
											</div>
										) : (
											<div className='vin-history-list'>
												{vinHistoryData.related_vehicles.map(vehicle => (
													<div
														key={vehicle.id}
														className={`vin-history-card ${
															vehicle.is_deleted ? 'deleted' : 'active'
														}`}
													>
														<div className='vin-history-card-top'>
															<strong>
																{getVinHistoryVehicleTitle(vehicle)}
															</strong>

															<span
																className={`vin-history-status ${
																	vehicle.is_deleted ? 'deleted' : 'active'
																}`}
															>
																{vehicle.is_deleted ? 'В корзине' : 'Активная'}
															</span>
														</div>

														<div className='vin-history-meta'>
															Клиент: {getVinHistoryClientName(vehicle)}
														</div>

														{vehicle.is_deleted && (
															<div className='vin-history-delete-info'>
																Удалил: {vehicle.deleted_by_name || '—'} ·{' '}
																{vehicle.deleted_at
																	? new Date(vehicle.deleted_at).toLocaleString(
																			'ru-RU',
																		)
																	: 'дата не указана'}
																{vehicle.delete_reason_type && (
																	<>
																		<br />
																		Причина:{' '}
																		{getVehicleDeleteReasonTypeLabel(
																			vehicle.delete_reason_type,
																		)}
																	</>
																)}
																{vehicle.delete_reason && (
																	<>
																		<br />
																		Комментарий: {vehicle.delete_reason}
																	</>
																)}
															</div>
														)}
													</div>
												))}
											</div>
										)}
									</div>

									<div className='vehicle-form-card'>
										<div className='vehicle-form-section-title'>
											Связи переиспользования VIN
										</div>

										{!vinHistoryData?.links ||
										vinHistoryData.links.length === 0 ? (
											<div className='vin-history-empty'>
												Связей переиспользования VIN пока нет. Если машина была
												создана до добавления этой функции, связь могла не
												сохраниться в отдельной таблице.
											</div>
										) : (
											<div className='vin-history-link-list'>
												{vinHistoryData.links.map(link => (
													<div key={link.id} className='vin-history-link-card'>
														<div className='vin-history-link-arrow'>
															<div>
																<span className='vin-history-link-label'>
																	Старая машина
																</span>
																<strong>
																	{getVinHistoryVehicleTitle(link.old_vehicle)}
																</strong>
																<span>
																	Клиент:{' '}
																	{getVinHistoryClientName(link.old_vehicle)}
																</span>
															</div>

															<div className='vin-history-arrow-symbol'>→</div>

															<div>
																<span className='vin-history-link-label'>
																	Новая машина
																</span>
																<strong>
																	{getVinHistoryVehicleTitle(link.new_vehicle)}
																</strong>
																<span>
																	Клиент:{' '}
																	{getVinHistoryClientName(link.new_vehicle)}
																</span>
															</div>
														</div>

														<div className='vin-history-meta'>
															Связь создана:{' '}
															{link.created_at
																? new Date(link.created_at).toLocaleString(
																		'ru-RU',
																	)
																: 'дата не указана'}{' '}
															· Пользователь: {link.created_by_name || '—'}
														</div>
													</div>
												))}
											</div>
										)}
									</div>
								</>
							)}
						</div>

						<div className='modal-footer vehicle-modal-footer'>
							<button
								className='vehicle-cancel-btn'
								type='button'
								onClick={closeVinHistoryModal}
							>
								Закрыть
							</button>
						</div>
					</div>
				</div>
			)}

			<AttachEquipmentToVehicleModal
				isOpen={Boolean(attachEquipmentVehicle)}
				mode='vehicle-first'
				initialVehicle={attachEquipmentVehicle}
				initialVehicleId={attachEquipmentVehicle?.id || null}
				onClose={closeAttachEquipmentToVehicleModal}
				onAttached={handleDirectVehicleEquipmentAttached}
			/>

			<CreateClientModal
				isOpen={isCreateModalOpen}
				editClient={editClientData}
				onClose={() => {
					setCreateModalOpen(false)
					setEditClientData(null)
				}}
				onCreated={async () => {
					const editedClientId = editClientData?.id

					setCreateModalOpen(false)
					setEditClientData(null)

					refreshClientsData()
					fetchClients({ silent: true })

					if (editedClientId && selectedClient?.id === editedClientId) {
						const freshClient = await fetchClientById(editedClientId)

						if (freshClient) {
							setSelectedClient(prev =>
								prev && Number(prev.id) === Number(freshClient.id)
									? {
											...prev,
											...freshClient,
										}
									: prev,
							)
						}
					}
				}}
			/>

			<RequestDetailModal
				isOpen={!!selectedRequestId}
				requestId={selectedRequestId}
				onClose={() => setSelectedRequestId(null)}
				onUpdated={() => {
					if (selectedClient) handleClientClick(selectedClient)
				}}
			/>
		</div>
	)
}
