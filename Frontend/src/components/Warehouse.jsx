import React, { useState, useEffect, useRef } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import { useLocation } from 'react-router'
import '../styles/Requests.css'
import '../styles/Warehouse.css'
import WarehouseItemModal from './WarehouseItemModal'
import AttachEquipmentToVehicleModal from './AttachEquipmentToVehicleModal'
import { getStoredUser, hasAnyPermission, hasLegacyRole } from '../utils/access'

const CATEGORIES = {
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

const STATUSES = {
	IN_STOCK: 'На складе',
	RESERVED: 'Резерв',
	ASSIGNED_TO_TECH: 'У монтажника',
	INSTALLED: 'Установлено',
	USED: 'Израсходовано',
	REPAIR: 'В ремонте',
	LOST: 'Потеряно',
	WRITTEN_OFF: 'Списано',
}

const STATUS_COLORS = {
	IN_STOCK: '#5e9424',
	RESERVED: '#f57c00',
	ASSIGNED_TO_TECH: '#7b1fa2',
	INSTALLED: '#1976d2',
	USED: '#455a64',
	REPAIR: '#f57c00',
	LOST: '#c62828',
	WRITTEN_OFF: '#c62828',
}

const CONDITION_STATUSES = {
	NEW: 'Новое',
	USED: 'БУ',
}

const HISTORY_ACTIONS = {
	CREATED: 'Добавлено на склад',
	UPDATED: 'Изменено',
	CITY_CHANGED: 'Город изменён',
	CITY_TRANSFERRED: 'Перенос между городами',
	CONSUMABLE_TRANSFERRED_OUT: 'Расходник списан из города',
	CONSUMABLE_TRANSFERRED_IN: 'Расходник поступил в город',

	IMPORT_CREATED: 'Добавлено через импорт',
	IMPORT_SERIALIZED_TRANSFERRED: 'Перенос через импорт',
	IMPORT_CONSUMABLE_ADDED: 'Расходник добавлен через импорт',
	IMPORT_CONSUMABLE_TRANSFERRED_OUT:
		'Расходник перенесён из города через импорт',
	IMPORT_CONSUMABLE_TRANSFERRED_IN: 'Расходник перенесён в город через импорт',

	ATTACHED_TO_REQUEST: 'Привязано к заявке',
	INSTALLED_FROM_TECH: 'Установлено монтажником',
	DETACHED_FROM_REQUEST: 'Отвязано от заявки',
	REMOVAL_COMPLETED_MARKED_USED: 'Снято по заявке и помечено как БУ',
	RETURNABLE_CONSUMABLE_RETURNED_AFTER_REMOVAL:
		'Возвратный расходник возвращён после снятия',

	INSTALLED_TO_VEHICLE_DIRECT: 'Привязано к авто напрямую',
	CONSUMABLE_USED_TO_VEHICLE_DIRECT: 'Расходник привязан к авто напрямую',
	DETACHED_FROM_VEHICLE_DIRECT: 'Отвязано от авто напрямую',

	DELETED: 'Перемещено в корзину',
	RESTORED: 'Восстановлено из корзины',
	WRITTEN_OFF: 'Списано',

	ISSUED_TO_USER: 'Выдано сотруднику',
	RETURNED_FROM_USER: 'Возвращено от сотрудника',

	ASSIGNED_TO_TECH: 'Выдано монтажнику',
	CONSUMABLE_ASSIGNED_OUT: 'Расходник выдан со склада',
	CONSUMABLE_ASSIGNED_TO_TECH: 'Расходник получен монтажником',

	RETURNED_TO_STOCK: 'Возвращено на склад',
	CONSUMABLE_RETURNED_FROM_TECH_OUT: 'Расходник возвращён монтажником',
	CONSUMABLE_RETURNED_TO_STOCK: 'Расходник возвращён на склад',

	MANUAL_ADDED_TO_TECH: 'Ручное добавление монтажнику',
	MANUAL_CONSUMABLE_ADDED_TO_TECH: 'Ручное добавление расходника монтажнику',

	INVENTORY_TRANSFERRED_TO_USER: 'Передано другому монтажнику',
	INVENTORY_TRANSFERRED_TO_STOCK: 'Возвращено на склад из инвентаря',

	CONSUMABLE_INVENTORY_TRANSFERRED_OUT: 'Расходник передан другому монтажнику',
	CONSUMABLE_INVENTORY_TRANSFERRED_IN:
		'Расходник получен от другого монтажника',

	CONSUMABLE_INVENTORY_TRANSFERRED_TO_STOCK_OUT:
		'Расходник списан из инвентаря на склад',
	CONSUMABLE_INVENTORY_TRANSFERRED_TO_STOCK_IN:
		'Расходник принят на склад из инвентаря',
}

export default function Warehouse() {
	const [items, setItems] = useState([])
	const [groupedItems, setGroupedItems] = useState([])
	const [expandedCategories, setExpandedCategories] = useState({})
	const [expandedItemGroups, setExpandedItemGroups] = useState({})
	const [loading, setLoading] = useState(false)
	const [filters, setFilters] = useState({
		search: '',
		category: '',
		status: '',
		city_id: '',
	})
	const [viewMode, setViewMode] = useState('active') // active | trash
	const [cities, setCities] = useState([])
	const [lockedCityId, setLockedCityId] = useState(null)
	const [technicians, setTechnicians] = useState([])
	const [transferItem, setTransferItem] = useState(null)
	const [transferForm, setTransferForm] = useState({
		from_city_id: '',
		to_city_id: '',
		quantity: 1,
		reason: '',
	})
	const [transferLoading, setTransferLoading] = useState(false)
	const [assignItem, setAssignItem] = useState(null)
	const [assignForm, setAssignForm] = useState({
		target_user_id: '',
		quantity: 1,
		reason: '',
	})
	const [assignLoading, setAssignLoading] = useState(false)
	const [attachVehicleItem, setAttachVehicleItem] = useState(null)

	const [historyItem, setHistoryItem] = useState(null)
	const [historyRows, setHistoryRows] = useState([])
	const [historyLoading, setHistoryLoading] = useState(false)

	const [isModalOpen, setIsModalOpen] = useState(false)
	const [editItem, setEditItem] = useState(null)
	const [importResult, setImportResult] = useState(null)
	const [pendingImportFile, setPendingImportFile] = useState(null)
	const [importPreview, setImportPreview] = useState(null)
	const [importPreviewOpen, setImportPreviewOpen] = useState(false)
	const [importConfirmLoading, setImportConfirmLoading] = useState(false)

	const [importFromCityId, setImportFromCityId] = useState('')
	const [importToCityId, setImportToCityId] = useState('')
	const [importEditedQuantities, setImportEditedQuantities] = useState({})

	const fileInputRef = useRef(null)

	const location = useLocation()
	const currentUser = getStoredUser()

	const canViewWarehouse =
		hasAnyPermission(currentUser, [
			'warehouse.view',
			'warehouse.manage',
			'warehouse.items.view',
			'warehouse.items.manage',
		]) ||
		hasLegacyRole(currentUser, [
			'ADMIN',
			'ROP',
			'MANAGER',
			'WAREHOUSE_MANAGER',
			'TECHNICIAN',
			'SENIOR_TECHNICIAN',
		])

	const canManageWarehouse =
		hasAnyPermission(currentUser, [
			'warehouse.manage',
			'warehouse.items.manage',
		]) || hasLegacyRole(currentUser, ['ADMIN', 'WAREHOUSE_MANAGER'])

	const canCreateWarehouseItem =
		hasAnyPermission(currentUser, [
			'warehouse.items.create',
			'warehouse.items.manage',
			'warehouse.manage',
		]) || hasLegacyRole(currentUser, ['ADMIN', 'WAREHOUSE_MANAGER'])

	const canEditWarehouseItem =
		hasAnyPermission(currentUser, [
			'warehouse.items.edit',
			'warehouse.items.manage',
			'warehouse.manage',
		]) || hasLegacyRole(currentUser, ['ADMIN', 'WAREHOUSE_MANAGER'])

	const canDeleteWarehouseItem =
		hasAnyPermission(currentUser, [
			'warehouse.items.delete',
			'warehouse.items.manage',
			'warehouse.manage',
		]) || hasLegacyRole(currentUser, ['ADMIN', 'WAREHOUSE_MANAGER'])

	const canRestoreWarehouseItem =
		hasAnyPermission(currentUser, [
			'warehouse.items.restore',
			'warehouse.trash.manage',
			'warehouse.items.manage',
			'warehouse.manage',
		]) || hasLegacyRole(currentUser, ['ADMIN', 'WAREHOUSE_MANAGER'])

	const canViewWarehouseTrash =
		hasAnyPermission(currentUser, [
			'warehouse.trash.view',
			'warehouse.deleted.view',
			'warehouse.items.restore',
			'warehouse.items.delete',
			'warehouse.items.manage',
			'warehouse.manage',
			'trash.view',
			'trash.manage',
		]) || hasLegacyRole(currentUser, ['ADMIN', 'ROP', 'WAREHOUSE_MANAGER'])

	const canImportWarehouse =
		hasAnyPermission(currentUser, [
			'warehouse.import',
			'warehouse.items.import',
			'warehouse.items.create',
			'warehouse.items.manage',
			'warehouse.manage',
		]) || hasLegacyRole(currentUser, ['ADMIN', 'WAREHOUSE_MANAGER'])

	const canTransferWarehouse =
		hasAnyPermission(currentUser, [
			'warehouse.transfer',
			'warehouse.items.transfer',
			'warehouse.items.manage',
			'warehouse.manage',
		]) || hasLegacyRole(currentUser, ['ADMIN', 'WAREHOUSE_MANAGER'])

	const canAssignWarehouseToEmployee =
		hasAnyPermission(currentUser, [
			'warehouse.employee_equipment.manage',
			'warehouse.employee_inventory.manage',
			'warehouse.technician_inventory.manage',
			'warehouse.inventory.manage_all',
			'warehouse.items.assign',
			'warehouse.items.manage',
			'warehouse.manage',
		]) || hasLegacyRole(currentUser, ['ADMIN', 'WAREHOUSE_MANAGER'])

	const canAttachWarehouseItemToVehicle =
		hasAnyPermission(currentUser, [
			'warehouse.vehicle_equipment.manage',
			'vehicles.equipment.manage',
			'vehicles.equipment.attach',
			'vehicles.manage',
			'warehouse.items.manage',
			'warehouse.manage',
		]) || hasLegacyRole(currentUser, ['ADMIN', 'WAREHOUSE_MANAGER'])

	const canViewWarehouseHistory =
		hasAnyPermission(currentUser, [
			'warehouse.history.view',
			'warehouse.items.history.view',
			'warehouse.items.view',
			'warehouse.view',
			'warehouse.manage',
		]) ||
		canViewWarehouse ||
		canManageWarehouse

	const itemRefs = useRef({})
	const [highlightedItemId, setHighlightedItemId] = useState(null)
	const [pendingHighlightItemId, setPendingHighlightItemId] = useState(null)

	useEffect(() => {
		if (viewMode === 'active') {
			fetchItems()
		} else {
			fetchDeletedItems()
		}
	}, [filters, viewMode])

	useEffect(() => {
		if (!canViewWarehouseTrash && viewMode === 'trash') {
			setViewMode('active')
		}
	}, [canViewWarehouseTrash, viewMode])

	useEffect(() => {
		fetchCities()

		if (canAssignWarehouseToEmployee) {
			fetchTechnicians()
		}
	}, [canAssignWarehouseToEmployee])

	useEffect(() => {
		const highlightWarehouseItemId = location.state?.highlightWarehouseItemId

		if (!highlightWarehouseItemId) return

		const itemId = Number(highlightWarehouseItemId)

		setViewMode('active')
		setPendingHighlightItemId(itemId)
		setHighlightedItemId(itemId)

		// Сбрасываем фильтры, чтобы найденное устройство точно было видно
		setFilters({
			search: '',
			category: '',
			status: '',
			city_id: lockedCityId ? String(lockedCityId) : '',
		})
	}, [location.state?.searchActionId, lockedCityId])

	useEffect(() => {
		if (!pendingHighlightItemId || items.length === 0) return

		const itemExists = items.some(
			item => Number(item.id) === Number(pendingHighlightItemId),
		)

		if (!itemExists) return

		setTimeout(() => {
			const el = itemRefs.current[Number(pendingHighlightItemId)]

			if (el) {
				el.scrollIntoView({ behavior: 'smooth', block: 'center' })
			}
		}, 150)

		const timeout = setTimeout(() => {
			setHighlightedItemId(null)
			setPendingHighlightItemId(null)
		}, 2500)

		return () => clearTimeout(timeout)
	}, [items, pendingHighlightItemId])

	const fetchCities = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/warehouse/cities`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) return

			const data = await res.json()
			const list = Array.isArray(data?.cities) ? data.cities : []
			const locked = data?.locked_city_id ?? null

			setCities(list)
			setLockedCityId(locked)

			if (locked) {
				setFilters(prev =>
					String(prev.city_id) === String(locked)
						? prev
						: { ...prev, city_id: String(locked) },
				)
			}
		} catch (err) {
			console.error('Ошибка загрузки городов:', err)
		}
	}

	const fetchTechnicians = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/users/technicians`, {
				headers: getAuthHeaders(),
			})

			if (res.ok) {
				const data = await res.json()
				setTechnicians(Array.isArray(data) ? data : [])
			}
		} catch (err) {
			console.error('Ошибка загрузки монтажников:', err)
		}
	}

	const fetchItems = async () => {
		setLoading(true)

		try {
			const params = new URLSearchParams()

			if (filters.category) params.append('category', filters.category)
			if (filters.status) params.append('status', filters.status)
			if (filters.search) params.append('search', filters.search)
			if (filters.city_id) params.append('city_id', filters.city_id)

			const [flatRes, groupedRes] = await Promise.all([
				fetch(`${API_BASE_URL}/warehouse/items?${params.toString()}`, {
					headers: getAuthHeaders(),
				}),
				fetch(`${API_BASE_URL}/warehouse/items/grouped?${params.toString()}`, {
					headers: getAuthHeaders(),
				}),
			])

			if (flatRes.ok) {
				setItems(await flatRes.json())
			}

			if (groupedRes.ok) {
				const data = await groupedRes.json()
				const groups = Array.isArray(data) ? data : []

				setGroupedItems(groups)

				setExpandedCategories(prev => {
					const next = { ...prev }

					groups.forEach(categoryGroup => {
						if (next[categoryGroup.category] === undefined) {
							next[categoryGroup.category] = true
						}
					})

					return next
				})
			}
		} catch (err) {
			console.error(err)
		} finally {
			setLoading(false)
		}
	}

	const fetchDeletedItems = async () => {
		if (!canViewWarehouseTrash) {
			setItems([])
			setLoading(false)
			return
		}

		setLoading(true)

		try {
			const res = await fetch(`${API_BASE_URL}/warehouse/deleted`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const err = await res.json().catch(() => null)
				throw new Error(err?.detail || 'Не удалось загрузить корзину склада')
			}

			const data = await res.json()

			let result = Array.isArray(data) ? data : []

			if (filters.search) {
				const s = filters.search.toLowerCase()

				result = result.filter(
					item =>
						(item.name && item.name.toLowerCase().includes(s)) ||
						(item.model && item.model.toLowerCase().includes(s)) ||
						(item.manufacturer &&
							item.manufacturer.toLowerCase().includes(s)) ||
						(item.identifier_value &&
							item.identifier_value.toLowerCase().includes(s)) ||
						(item.serial_number &&
							item.serial_number.toLowerCase().includes(s)),
				)
			}

			if (filters.category) {
				result = result.filter(item => item.category === filters.category)
			}

			if (filters.status) {
				result = result.filter(item => item.status === filters.status)
			}

			setItems(result)
		} catch (err) {
			alert(err.message)
		} finally {
			setLoading(false)
		}
	}

	const handleFilterChange = e =>
		setFilters({ ...filters, [e.target.name]: e.target.value })
	const resetFilters = () =>
		setFilters({
			search: '',
			category: '',
			status: '',
			city_id: lockedCityId ? String(lockedCityId) : '',
		})

	const handleDelete = async id => {
		if (!canDeleteWarehouseItem) {
			alert('Недостаточно прав для удаления оборудования')
			return
		}

		if (!window.confirm('Переместить оборудование в корзину?')) return

		try {
			const res = await fetch(`${API_BASE_URL}/warehouse/items/${id}`, {
				method: 'DELETE',
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const err = await res.json().catch(() => null)
				throw new Error(
					err?.detail || 'Не удалось переместить оборудование в корзину',
				)
			}

			fetchItems()
		} catch (err) {
			alert(err.message)
		}
	}

	const handleRestore = async id => {
		if (!canRestoreWarehouseItem) {
			alert('Недостаточно прав для восстановления оборудования')
			return
		}

		if (!window.confirm('Восстановить оборудование из корзины?')) return

		try {
			const res = await fetch(`${API_BASE_URL}/warehouse/items/${id}/restore`, {
				method: 'PATCH',
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const err = await res.json().catch(() => null)
				throw new Error(err?.detail || 'Ошибка восстановления')
			}

			fetchDeletedItems()
		} catch (err) {
			alert(err.message)
		}
	}

	// ИМПОРТ CSV
	const handleFileUpload = async e => {
		const file = e.target.files[0]

		if (!file) return

		if (!canImportWarehouse) {
			alert('Недостаточно прав для импорта оборудования')
			e.target.value = ''
			return
		}

		try {
			const defaultFromCityId = getDefaultAlmatyCityId()
			const defaultToCityId = filters.city_id || defaultFromCityId

			const preview = await buildImportPreview(
				file,
				defaultFromCityId,
				defaultToCityId,
			)

			setImportFromCityId(defaultFromCityId)
			setImportToCityId(defaultToCityId)
			setImportEditedQuantities({})
			setPendingImportFile(file)
			setImportPreview(preview)
			setImportPreviewOpen(true)
		} catch (err) {
			alert(`Ошибка проверки CSV: ${err.message}`)
		} finally {
			e.target.value = ''
		}
	}

	const handleConfirmImport = async () => {
		if (!pendingImportFile) return

		if (!canImportWarehouse) {
			alert('Недостаточно прав для импорта оборудования')
			return
		}

		if (!importFromCityId) {
			alert('Выберите город отправления')
			return
		}

		if (!importToCityId) {
			alert('Выберите город назначения')
			return
		}

		setImportConfirmLoading(true)

		const formData = new FormData()
		formData.append('file', pendingImportFile)
		formData.append('from_city_id', importFromCityId)
		formData.append('to_city_id', importToCityId)
		formData.append(
			'edited_quantities_json',
			JSON.stringify(importEditedQuantities),
		)

		try {
			const res = await fetch(`${API_BASE_URL}/warehouse/import`, {
				method: 'POST',
				headers: getAuthHeaders(),
				body: formData,
			})

			const data = await res.json()

			if (!res.ok) {
				throw new Error(data.detail || 'Ошибка импорта')
			}

			setImportPreviewOpen(false)
			setImportPreview(null)
			setPendingImportFile(null)
			setImportFromCityId('')
			setImportToCityId('')
			setImportEditedQuantities({})

			setImportResult(buildImportMessage(data))
			fetchItems()
		} catch (err) {
			alert(`Ошибка: ${err.message}`)
		} finally {
			setImportConfirmLoading(false)
		}
	}

	const handleCancelImport = () => {
		setImportPreviewOpen(false)
		setImportPreview(null)
		setPendingImportFile(null)
		setImportFromCityId('')
		setImportToCityId('')
		setImportEditedQuantities({})
	}

	const rebuildImportPreviewWithCities = async (fromCityId, toCityId) => {
		if (!pendingImportFile) return

		try {
			const preview = await buildImportPreview(
				pendingImportFile,
				fromCityId,
				toCityId,
			)
			setImportPreview(preview)
			setImportEditedQuantities({})
		} catch (err) {
			alert(`Ошибка проверки CSV: ${err.message}`)
		}
	}

	const handleImportFromCityChange = e => {
		const nextFromCityId = e.target.value
		setImportFromCityId(nextFromCityId)
		rebuildImportPreviewWithCities(nextFromCityId, importToCityId)
	}

	const handleImportToCityChange = e => {
		const nextToCityId = e.target.value
		setImportToCityId(nextToCityId)
		rebuildImportPreviewWithCities(importFromCityId, nextToCityId)
	}

	const handleImportQuantityChange = (rowNumber, value) => {
		const quantity = Math.max(1, Number(value || 1))

		setImportEditedQuantities(prev => ({
			...prev,
			[String(rowNumber)]: quantity,
		}))

		setImportPreview(prev => {
			if (!prev) return prev

			const updateRows = rows =>
				rows.map(row =>
					Number(row.rowNumber) === Number(rowNumber)
						? {
								...row,
								quantity: String(quantity),
							}
						: row,
				)

			return {
				...prev,
				validRows: updateRows(prev.validRows || []),
				consumableTransferRows: updateRows(prev.consumableTransferRows || []),
				consumableAddRows: updateRows(prev.consumableAddRows || []),
			}
		})
	}

	const parseCsvLine = line => {
		const result = []
		let current = ''
		let insideQuotes = false

		for (let i = 0; i < line.length; i += 1) {
			const char = line[i]
			const nextChar = line[i + 1]

			if (char === '"' && insideQuotes && nextChar === '"') {
				current += '"'
				i += 1
				continue
			}

			if (char === '"') {
				insideQuotes = !insideQuotes
				continue
			}

			if (char === ';' && !insideQuotes) {
				result.push(current.trim())
				current = ''
				continue
			}

			current += char
		}

		result.push(current.trim())

		return result
	}

	const normalizeCsvHeader = value => {
		return String(value || '')
			.trim()
			.toLowerCase()
			.replace(/\s+/g, '_')
	}

	const getCsvValue = (row, aliases) => {
		for (const alias of aliases) {
			const normalizedAlias = normalizeCsvHeader(alias)

			if (row[normalizedAlias] !== undefined) {
				return row[normalizedAlias]
			}
		}

		return ''
	}

	const normalizeIdentifierType = value => {
		const type = String(value || '')
			.trim()
			.toUpperCase()

		if (!type) return 'NONE'

		return type
	}

	const normalizeIdentifierValue = value => {
		return String(value || '').trim()
	}

	const buildWarehouseItemKey = (identifierType, identifierValue) => {
		const type = normalizeIdentifierType(identifierType)
		const value = normalizeIdentifierValue(identifierValue).toLowerCase()

		if (!value || type === 'NONE') return null

		return `${type}:${value}`
	}

	const normalizeConditionStatus = value => {
		const normalized = String(value || '')
			.trim()
			.toUpperCase()

		if (
			['USED', 'БУ', 'Б/У', 'B/U', '1', 'TRUE', 'YES', 'Y', 'ДА'].includes(
				normalized,
			)
		) {
			return 'USED'
		}

		return 'NEW'
	}

	const getConditionLabel = value => {
		const conditionStatus = normalizeConditionStatus(value)
		return CONDITION_STATUSES[conditionStatus] || conditionStatus
	}

	const isUsedItem = item => {
		return normalizeConditionStatus(item?.condition_status) === 'USED'
	}

	const renderConditionBadge = item => {
		if (!isUsedItem(item)) return null

		return (
			<span className='warehouse-condition-badge warehouse-condition-badge-used'>
				БУ
			</span>
		)
	}

	const getImportConditionText = row => {
		const conditionStatus = normalizeConditionStatus(row?.condition_status)

		if (conditionStatus !== 'USED') return ''

		return ' · БУ'
	}

	const readFileAsText = file => {
		return new Promise((resolve, reject) => {
			const reader = new FileReader()

			reader.onload = event => resolve(event.target.result)
			reader.onerror = () => reject(new Error('Не удалось прочитать CSV-файл'))

			reader.readAsText(file, 'UTF-8')
		})
	}

	const fetchAllActiveWarehouseItems = async () => {
		const res = await fetch(`${API_BASE_URL}/warehouse/items`, {
			headers: getAuthHeaders(),
		})

		if (!res.ok) {
			const err = await res.json().catch(() => null)
			throw new Error(
				err?.detail || 'Не удалось проверить склад перед импортом',
			)
		}

		const data = await res.json()

		return Array.isArray(data) ? data : []
	}

	const buildImportPreview = async (file, fromCityId, toCityId) => {
		const text = await readFileAsText(file)
		const cleanedText = text.replace(/^\uFEFF/, '')
		const lines = cleanedText
			.split(/\r?\n/)
			.map(line => line.trim())
			.filter(Boolean)

		if (lines.length < 2) {
			throw new Error('CSV-файл пустой или не содержит строк для импорта')
		}

		const headers = parseCsvLine(lines[0]).map(normalizeCsvHeader)

		const rows = lines.slice(1).map((line, index) => {
			const values = parseCsvLine(line)
			const row = {}

			headers.forEach((header, headerIndex) => {
				row[header] = values[headerIndex] || ''
			})

			return {
				rowNumber: index + 2,
				raw: row,
			}
		})

		const activeItems = await fetchAllActiveWarehouseItems()

		const fromCityName = getCityName(fromCityId)
		const toCityName = getCityName(toCityId)

		const existingKeys = new Map()

		activeItems.forEach(item => {
			const key = buildWarehouseItemKey(
				item.identifier_type,
				item.identifier_value,
			)

			if (!key) return

			existingKeys.set(key, item)
		})

		const fileKeys = new Map()

		const validRows = []
		const duplicateRows = []
		const transferRows = []
		const consumableTransferRows = []
		const consumableAddRows = []
		const invalidRows = []

		rows.forEach(rowInfo => {
			const row = rowInfo.raw

			const category = getCsvValue(row, ['category', 'категория'])
			const name = getCsvValue(row, ['name', 'наименование', 'название'])
			const manufacturer = getCsvValue(row, ['manufacturer', 'производитель'])
			const model = getCsvValue(row, ['model', 'модель'])
			const identifierType = getCsvValue(row, [
				'identifier_type',
				'тип_id',
				'type_id',
				'id_type',
			])
			const identifierValue = getCsvValue(row, [
				'identifier_value',
				'значение_id',
				'imei',
				'mac',
				'serial',
				'id',
			])
			const serialNumber = getCsvValue(row, [
				'serial_number',
				'серийный_номер',
				's/n',
				'sn',
			])
			const isSerializedRaw = getCsvValue(row, [
				'is_serialized',
				'серийное',
				'serialized',
			])
			const quantity = getCsvValue(row, ['quantity', 'количество', 'кол-во'])

			const conditionStatus = normalizeConditionStatus(
				getCsvValue(row, [
					'condition_status',
					'состояние',
					'статус_бу',
					'бу',
					'б/у',
					'used',
				]),
			)

			const isSerialized =
				String(isSerializedRaw || '')
					.trim()
					.toLowerCase() === 'false'
					? false
					: true

			const itemPreview = {
				rowNumber: rowInfo.rowNumber,
				category,
				name,
				manufacturer,
				model,
				identifier_type: isSerialized
					? normalizeIdentifierType(identifierType || 'IMEI')
					: 'NONE',
				identifier_value: isSerialized
					? normalizeIdentifierValue(identifierValue)
					: '',
				serial_number: serialNumber,
				is_serialized: isSerialized,
				quantity: quantity || '1',
				condition_status: conditionStatus,
			}

			if (!name.trim()) {
				invalidRows.push({
					...itemPreview,
					reason: 'Не указано наименование',
				})
				return
			}

			if (isSerialized && !itemPreview.identifier_value) {
				invalidRows.push({
					...itemPreview,
					reason: 'Для серийного оборудования не указан идентификатор',
				})
				return
			}

			const key = buildWarehouseItemKey(
				itemPreview.identifier_type,
				itemPreview.identifier_value,
			)

			if (key && existingKeys.has(key)) {
				const existingItem = existingKeys.get(key)
				const existingCityId = Number(existingItem.city_id)
				const fromId = Number(fromCityId)
				const toId = Number(toCityId)

				if (existingCityId === toId) {
					duplicateRows.push({
						...itemPreview,
						reason: `Уже есть в городе ${existingItem.city_name || getCityName(existingItem.city_id)}`,
						existing_item: existingItem,
					})
					return
				}

				if (existingCityId === fromId) {
					if (existingItem.status !== 'IN_STOCK') {
						invalidRows.push({
							...itemPreview,
							reason: `Нельзя перенести: статус ${STATUSES[existingItem.status] || existingItem.status}`,
							existing_item: existingItem,
						})
						return
					}

					transferRows.push({
						...itemPreview,
						reason: `Будет перенесено: ${existingItem.city_name || fromCityName} → ${toCityName}`,
						existing_item: existingItem,
					})
					return
				}

				invalidRows.push({
					...itemPreview,
					reason: `Устройство найдено в другом городе: ${existingItem.city_name || getCityName(existingItem.city_id)}. Выберите этот город как “Из города”.`,
					existing_item: existingItem,
				})
				return
			}

			if (key && fileKeys.has(key)) {
				duplicateRows.push({
					...itemPreview,
					reason: `Дубликат внутри CSV. Такая же строка уже есть в строке ${fileKeys.get(key)}`,
				})
				return
			}

			if (!isSerialized) {
				const quantityNumber = Math.max(1, Number(itemPreview.quantity || 1))

				const consumableRow = {
					...itemPreview,
					quantity: String(quantityNumber),
					from_city_id: fromCityId,
					to_city_id: toCityId,
				}

				if (Number(fromCityId) === Number(toCityId)) {
					consumableAddRows.push({
						...consumableRow,
						reason: `Будет добавлено/суммировано в городе ${toCityName}`,
					})
					return
				}

				const sourceItem = activeItems.find(item => {
					if (item.is_serialized) return false
					if (Number(item.city_id) !== Number(fromCityId)) return false

					const sameCategory =
						String(item.category || '') === String(category || '')
					const sameName =
						String(item.name || '')
							.trim()
							.toLowerCase() ===
						String(name || '')
							.trim()
							.toLowerCase()
					const sameManufacturer =
						String(item.manufacturer || '')
							.trim()
							.toLowerCase() ===
						String(manufacturer || '')
							.trim()
							.toLowerCase()
					const sameModel =
						String(item.model || '')
							.trim()
							.toLowerCase() ===
						String(model || '')
							.trim()
							.toLowerCase()

					const sameCondition =
						normalizeConditionStatus(item.condition_status) === conditionStatus

					return (
						sameCategory &&
						sameName &&
						sameManufacturer &&
						sameModel &&
						sameCondition
					)
				})

				if (!sourceItem) {
					invalidRows.push({
						...consumableRow,
						reason: `Расходник не найден в городе отправления: ${fromCityName}`,
					})
					return
				}

				if (quantityNumber > Number(sourceItem.quantity || 0)) {
					invalidRows.push({
						...consumableRow,
						reason: `Недостаточно в городе ${fromCityName}. Доступно: ${sourceItem.quantity || 0}`,
						existing_item: sourceItem,
					})
					return
				}

				consumableTransferRows.push({
					...consumableRow,
					reason: `Будет перенесено: ${fromCityName} → ${toCityName}`,
					existing_item: sourceItem,
				})

				return
			}

			if (key) {
				fileKeys.set(key, rowInfo.rowNumber)
			}

			validRows.push(itemPreview)
		})

		return {
			fileName: file.name,
			totalRows: rows.length,
			fromCityId,
			toCityId,
			fromCityName,
			toCityName,
			validRows,
			duplicateRows,
			transferRows,
			consumableTransferRows,
			consumableAddRows,
			invalidRows,
		}
	}

	const buildImportMessage = data => {
		const lines = []

		lines.push(`Добавлено новых объектов: ${data.imported_count || 0}`)
		lines.push(`Перенесено серийных объектов: ${data.transferred_count || 0}`)
		lines.push(
			`Обновлено/перенесено расходников: ${data.consumables_updated_count || 0}`,
		)
		lines.push(`Пропущено: ${data.skipped_count || 0}`)

		const errors = data.errors || []

		if (errors.length > 0) {
			lines.push('Пропущено:')

			errors.forEach(err => {
				if (err.identifier_type && err.identifier_value) {
					lines.push(`${err.identifier_type}: ${err.identifier_value}`)
				} else if (err.row && err.error) {
					lines.push(`Строка ${err.row}: ${err.error}`)
				} else if (err.error) {
					lines.push(err.error)
				}
			})
		}

		return lines.join('\n\n')
	}

	// СКАЧАТЬ ШАБЛОН CSV
	const downloadTemplate = async () => {
		if (!canImportWarehouse) {
			alert('Недостаточно прав для скачивания шаблона импорта')
			return
		}

		const res = await fetch(`${API_BASE_URL}/warehouse/template`, {
			headers: getAuthHeaders(),
		})

		if (res.ok) {
			const blob = await res.blob()
			const url = window.URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = 'warehouse_template.csv'
			a.click()
			window.URL.revokeObjectURL(url)
		}
	}

	const openEdit = item => {
		if (!canEditWarehouseItem) {
			alert('Недостаточно прав для редактирования оборудования')
			return
		}

		setEditItem(item)
		setIsModalOpen(true)
	}

	// --- НОВЫЕ ФУНКЦИИ-ПОМОЩНИКИ ДЛЯ ОТРИСОВКИ КЛИЕНТА И АВТО ---
	const renderClientInfo = item => {
		if (item.status !== 'INSTALLED' && item.status !== 'Установлено') {
			return <span style={{ color: '#aaa' }}>—</span>
		}
		const type = String(item.client_type || '').toUpperCase()
		if (type === 'TOO' || type === 'IP' || type === 'ТОО' || type === 'ИП') {
			return item.company_name || item.client_name || '—'
		}
		return item.client_name || '—'
	}

	const renderCarInfo = (item, field) => {
		if (item.status !== 'INSTALLED' && item.status !== 'Установлено') {
			return <span style={{ color: '#aaa' }}>—</span>
		}
		return item[field] || '—'
	}

	const toggleCategory = category => {
		setExpandedCategories(prev => ({
			...prev,
			[category]: !prev[category],
		}))
	}

	const getItemGroupKey = (category, groupKey) => {
		return `${category}:${groupKey}`
	}

	const toggleItemGroup = (category, groupKey) => {
		const key = getItemGroupKey(category, groupKey)

		setExpandedItemGroups(prev => ({
			...prev,
			[key]: !prev[key],
		}))
	}

	const formatStatusCounts = (counts, isConsumable = false) => {
		const orderedStatuses = ['IN_STOCK', 'RESERVED', 'INSTALLED', 'WRITTEN_OFF']

		return orderedStatuses
			.filter(status => {
				const value = Number(counts?.[status] || 0)

				if (isConsumable) {
					return value > 0
				}

				return true
			})
			.map(
				status =>
					`${STATUSES[status] || status}: ${Number(counts?.[status] || 0)}`,
			)
			.join(' · ')
	}

	const isConsumableCategoryGroup = categoryGroup => {
		return (categoryGroup.groups || []).every(
			group => group.is_consumable_group,
		)
	}

	const getCityName = cityId => {
		const city = cities.find(item => Number(item.id) === Number(cityId))
		return city?.name || '—'
	}

	const getDefaultAlmatyCityId = () => {
		const almaty = cities.find(city =>
			String(city.name || '')
				.toLowerCase()
				.includes('алматы'),
		)

		return almaty?.id || cities[0]?.id || ''
	}

	const openTransferModal = item => {
		if (!canTransferWarehouse) {
			alert('Недостаточно прав для переноса оборудования')
			return
		}

		setTransferItem(item)
		setTransferForm({
			from_city_id: item.city_id || '',
			to_city_id: '',
			quantity: item.is_serialized ? 1 : 1,
			reason: '',
		})
	}

	const closeTransferModal = () => {
		setTransferItem(null)
		setTransferForm({
			from_city_id: '',
			to_city_id: '',
			quantity: 1,
			reason: '',
		})
	}

	const openAssignModal = item => {
		if (!canAssignWarehouseToEmployee) {
			alert('Недостаточно прав для выдачи оборудования сотруднику')
			return
		}

		setAssignItem(item)
		setAssignForm({
			target_user_id: '',
			quantity: item.is_serialized ? 1 : 1,
			reason: '',
		})
	}

	const closeAssignModal = () => {
		setAssignItem(null)
		setAssignForm({
			target_user_id: '',
			quantity: 1,
			reason: '',
		})
	}

	const canAttachItemToVehicle = item => {
		if (!canAttachWarehouseItemToVehicle) return false
		if (viewMode !== 'active') return false
		if (!item) return false
		if (item.status !== 'IN_STOCK') return false
		if (item.assigned_to_user_id) return false

		return Number(item.quantity || 0) > 0
	}

	const openAttachVehicleModal = item => {
		if (!canAttachWarehouseItemToVehicle) {
			alert('Недостаточно прав для прямой привязки оборудования к авто')
			return
		}

		setAttachVehicleItem(item)
	}

	const closeAttachVehicleModal = () => {
		setAttachVehicleItem(null)
	}

	const handleVehicleEquipmentAttached = () => {
		setAttachVehicleItem(null)
		fetchItems()
	}

	const handleAssignChange = e => {
		const { name, value } = e.target

		setAssignForm(prev => ({
			...prev,
			[name]: value,
		}))
	}

	const handleAssignSubmit = async e => {
		e.preventDefault()

		if (!canAssignWarehouseToEmployee) {
			alert('Недостаточно прав для выдачи оборудования сотруднику')
			return
		}

		if (!assignItem) return

		if (!assignForm.target_user_id) {
			alert('Выберите монтажника')
			return
		}

		const quantity = assignItem.is_serialized
			? 1
			: Number(assignForm.quantity || 0)

		if (quantity <= 0) {
			alert('Количество должно быть больше 0')
			return
		}

		if (
			!assignItem.is_serialized &&
			quantity > Number(assignItem.quantity || 0)
		) {
			alert(`Недостаточно количества. Доступно: ${assignItem.quantity || 0}`)
			return
		}

		setAssignLoading(true)

		try {
			const res = await fetch(
				`${API_BASE_URL}/warehouse/items/${assignItem.id}/assign-to-user`,
				{
					method: 'POST',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({
						target_user_id: Number(assignForm.target_user_id),
						quantity,
						reason: assignForm.reason.trim() || null,
					}),
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Ошибка выдачи монтажнику')
			}

			closeAssignModal()
			fetchItems()
		} catch (err) {
			alert(err.message)
		} finally {
			setAssignLoading(false)
		}
	}

	const handleTransferChange = e => {
		const { name, value } = e.target

		setTransferForm(prev => ({
			...prev,
			[name]: value,
		}))
	}

	const handleTransferSubmit = async e => {
		e.preventDefault()

		if (!canTransferWarehouse) {
			alert('Недостаточно прав для переноса оборудования')
			return
		}

		if (!transferItem) return

		if (!transferForm.from_city_id) {
			alert('Выберите город отправления')
			return
		}

		if (!transferForm.to_city_id) {
			alert('Выберите город назначения')
			return
		}

		if (Number(transferForm.from_city_id) === Number(transferForm.to_city_id)) {
			alert('Город отправления и город назначения не должны совпадать')
			return
		}

		const quantity = transferItem.is_serialized
			? 1
			: Number(transferForm.quantity || 0)

		if (quantity <= 0) {
			alert('Количество должно быть больше 0')
			return
		}

		if (
			!transferItem.is_serialized &&
			quantity > Number(transferItem.quantity || 0)
		) {
			alert(`Недостаточно количества. Доступно: ${transferItem.quantity || 0}`)
			return
		}

		setTransferLoading(true)

		try {
			const res = await fetch(
				`${API_BASE_URL}/warehouse/items/${transferItem.id}/transfer`,
				{
					method: 'POST',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({
						from_city_id: Number(transferForm.from_city_id),
						to_city_id: Number(transferForm.to_city_id),
						quantity,
						reason: transferForm.reason.trim() || null,
					}),
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Ошибка переноса')
			}

			closeTransferModal()
			fetchItems()
		} catch (err) {
			alert(err.message)
		} finally {
			setTransferLoading(false)
		}
	}

	const formatDateTime = value => {
		if (!value) return '—'

		try {
			return new Date(value).toLocaleString('ru-RU')
		} catch {
			return value
		}
	}

	const getHistoryActionLabel = action => {
		return HISTORY_ACTIONS[action] || action || 'Действие'
	}

	const openHistoryModal = async item => {
		setHistoryItem(item)
		setHistoryRows([])
		setHistoryLoading(true)

		try {
			const res = await fetch(
				`${API_BASE_URL}/warehouse/items/${item.id}/history`,
				{
					headers: getAuthHeaders(),
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось загрузить историю')
			}

			setHistoryRows(Array.isArray(data) ? data : [])
		} catch (err) {
			alert(err.message)
			setHistoryItem(null)
		} finally {
			setHistoryLoading(false)
		}
	}

	const closeHistoryModal = () => {
		setHistoryItem(null)
		setHistoryRows([])
		setHistoryLoading(false)
	}

	const renderHistoryMovementText = row => {
		const fromCity = row.from_city_name || null
		const toCity = row.to_city_name || null

		if (fromCity && toCity) {
			return `${fromCity} → ${toCity}`
		}

		if (toCity) {
			return `→ ${toCity}`
		}

		if (fromCity) {
			return `${fromCity} →`
		}

		return null
	}

	const renderHistoryVehicleText = row => {
		const vehicleParts = [row.brand, row.vehicle_model].filter(Boolean)
		const title = vehicleParts.join(' ').trim()

		if (!title && !row.plate_number && !row.vin) return null

		const details = []

		if (row.plate_number) details.push(row.plate_number)
		if (row.vin) details.push(row.vin)

		return `${title || 'Авто'}${details.length ? ` (${details.join(' · ')})` : ''}`
	}

	const renderWarehouseItemRow = item => {
		return (
			<tr
				key={item.id}
				ref={el => {
					itemRefs.current[Number(item.id)] = el
				}}
				className={`warehouse-item-row ${
					Number(highlightedItemId) === Number(item.id)
						? 'warehouse-item-highlighted'
						: ''
				}`}
				style={{ borderBottom: '1px solid #eee' }}
			>
				<td style={{ padding: '12px 15px' }}>
					<div className='cell-value'>
						<div className='warehouse-item-name-line'>
							<strong>{item.name}</strong>
							{renderConditionBadge(item)}
						</div>

						{item.model && (
							<div style={{ fontSize: '12px', color: '#888' }}>
								{item.manufacturer} {item.model}
							</div>
						)}

						{viewMode === 'trash' && (
							<div
								style={{
									fontSize: '12px',
									color: '#c62828',
									marginTop: '4px',
								}}
							>
								Удалено:{' '}
								{item.deleted_at
									? new Date(item.deleted_at).toLocaleString('ru-RU')
									: 'дата не указана'}
								{item.deleted_by_name ? ` · ${item.deleted_by_name}` : ''}
							</div>
						)}
					</div>
				</td>

				<td style={{ padding: '12px 15px' }}>
					<div className='cell-value'>
						{CATEGORIES[item.category] || item.category}
					</div>
				</td>

				<td style={{ padding: '12px 15px' }}>
					<div className='cell-value'>
						{item.is_serialized ? (
							<>
								<span style={{ color: '#888', fontSize: '11px' }}>
									{item.identifier_type}:
								</span>{' '}
								{item.identifier_value}
							</>
						) : (
							<span style={{ color: '#aaa', fontSize: '12px' }}>Расходник</span>
						)}
					</div>
				</td>

				<td style={{ padding: '12px 15px', fontWeight: 'bold' }}>
					<div className='cell-value'>{item.quantity} шт.</div>
				</td>

				<td style={{ padding: '12px 15px' }}>
					<div className='cell-value'>
						<span className='warehouse-city-badge'>
							{item.city_name || getCityName(item.city_id)}
						</span>
					</div>
				</td>

				<td style={{ padding: '12px 15px' }}>
					<div className='cell-value'>
						<span
							style={{
								background: STATUS_COLORS[item.status] || '#888',
								color: '#fff',
								padding: '2px 8px',
								borderRadius: '12px',
								fontSize: '11px',
								fontWeight: 'bold',
							}}
						>
							{STATUSES[item.status] || item.status}
						</span>
					</div>
				</td>

				<td
					style={{
						padding: '12px 15px',
						fontSize: '13px',
						fontWeight: '500',
					}}
				>
					<div className='cell-value'>{renderClientInfo(item)}</div>
				</td>

				<td style={{ padding: '12px 15px', fontSize: '13px' }}>
					<div className='cell-value'>
						{renderCarInfo(item, 'plate_number')}
					</div>
				</td>

				<td
					style={{
						padding: '12px 15px',
						fontSize: '12px',
						color: '#666',
					}}
				>
					<div className='cell-value'>{renderCarInfo(item, 'vin')}</div>
				</td>

				<td style={{ padding: '12px 15px', textAlign: 'right' }}>
					<div className='cell-value warehouse-cell-actions'>
						{viewMode === 'active' ? (
							<div className='warehouse-actions'>
								{canViewWarehouseHistory && (
									<button
										className='warehouse-action-btn warehouse-history-btn'
										onClick={() => openHistoryModal(item)}
										title='История оборудования'
									>
										🕘
									</button>
								)}

								{canAttachItemToVehicle(item) && (
									<button
										className='warehouse-action-btn warehouse-attach-vehicle-btn'
										onClick={() => openAttachVehicleModal(item)}
										title='Привязать к авто'
									>
										🚗
									</button>
								)}

								{canAssignWarehouseToEmployee && item.status === 'IN_STOCK' && (
									<button
										className='warehouse-action-btn warehouse-assign-btn'
										onClick={() => openAssignModal(item)}
										title='Выдать монтажнику'
									>
										👤
									</button>
								)}

								{canTransferWarehouse && (
									<button
										className='warehouse-action-btn warehouse-transfer-btn'
										onClick={() => openTransferModal(item)}
										title='Перенести в другой город'
									>
										↔
									</button>
								)}

								{canEditWarehouseItem && (
									<button
										className='warehouse-action-btn warehouse-edit-btn'
										onClick={() => openEdit(item)}
										title='Редактировать'
									>
										✎
									</button>
								)}

								{canDeleteWarehouseItem && (
									<button
										className='warehouse-action-btn warehouse-delete-btn'
										onClick={() => handleDelete(item.id)}
										title='Переместить в корзину'
									>
										🗑
									</button>
								)}
							</div>
						) : (
							<div className='warehouse-actions'>
								{canViewWarehouseHistory && (
									<button
										className='warehouse-action-btn warehouse-history-btn'
										onClick={() => openHistoryModal(item)}
										title='История оборудования'
									>
										🕘
									</button>
								)}

								{canRestoreWarehouseItem && (
									<button
										className='warehouse-restore-btn'
										onClick={() => handleRestore(item.id)}
									>
										Восстановить
									</button>
								)}
							</div>
						)}
					</div>
				</td>
			</tr>
		)
	}

	return (
		<div className='requests-page-container warehouse-page-container'>
			<style>{`
				@keyframes warehouseItemPulse {
					0% {
						background: #fffde7;
						box-shadow: inset 4px 0 0 #f9a825;
					}
					45% {
						background: #fffde7;
						box-shadow: inset 4px 0 0 #f9a825;
					}
					100% {
						background: transparent;
						box-shadow: none;
					}
				}

				.warehouse-item-highlighted {
					animation: warehouseItemPulse 2.5s ease-out forwards;
				}
			`}</style>
			<div
				className='clients-header-bar warehouse-header-bar'
				style={{ marginBottom: '15px' }}
			>
				<h2>Склад оборудования</h2>
				<div className='warehouse-header-actions'>
					{viewMode === 'active' && (
						<>
							{canImportWarehouse && (
								<>
									<button
										onClick={downloadTemplate}
										className='warehouse-top-btn btn-template'
									>
										📥 Шаблон CSV
									</button>

									<input
										type='file'
										accept='.csv'
										ref={fileInputRef}
										style={{ display: 'none' }}
										onChange={handleFileUpload}
									/>

									<button
										onClick={() => fileInputRef.current?.click()}
										className='warehouse-top-btn btn-import'
									>
										⬆️ Импорт CSV
									</button>
								</>
							)}

							{canCreateWarehouseItem && (
								<button
									className='btn-green warehouse-top-btn btn-add'
									onClick={() => {
										setEditItem(null)
										setIsModalOpen(true)
									}}
								>
									+ Добавить
								</button>
							)}
						</>
					)}
					<div className='warehouse-view-toggle'>
						<button
							type='button'
							className={`warehouse-toggle-btn ${viewMode === 'active' ? 'active' : ''}`}
							onClick={() => setViewMode('active')}
						>
							Активные
						</button>

						{canViewWarehouseTrash && (
							<button
								type='button'
								className={`warehouse-toggle-btn ${viewMode === 'trash' ? 'active' : ''}`}
								onClick={() => setViewMode('trash')}
							>
								Корзина
							</button>
						)}
					</div>
				</div>
			</div>

			<div
				className='filters-bar warehouse-filters'
				style={{ marginBottom: '20px' }}
			>
				<div className='filter-group filter-search-group'>
					<label>Поиск по складу</label>
					<input
						className='filter-input'
						type='text'
						name='search'
						placeholder='Наименование, модель, IMEI...'
						value={filters.search}
						onChange={handleFilterChange}
					/>
				</div>
				<div className='filter-group'>
					<label>Категория</label>
					<select
						className='filter-select'
						name='category'
						value={filters.category}
						onChange={handleFilterChange}
					>
						<option value=''>Все категории</option>
						{Object.entries(CATEGORIES).map(([k, v]) => (
							<option key={k} value={k}>
								{v}
							</option>
						))}
					</select>
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
						{Object.entries(STATUSES).map(([k, v]) => (
							<option key={k} value={k}>
								{v}
							</option>
						))}
					</select>
				</div>
				<div className='filter-group'>
					<label>Город склада</label>
					<select
						className='filter-select'
						name='city_id'
						value={filters.city_id}
						onChange={handleFilterChange}
						disabled={Boolean(lockedCityId)}
					>
						{!lockedCityId && <option value=''>Все города</option>}

						{cities.map(city => (
							<option key={city.id} value={city.id}>
								{city.name}
							</option>
						))}
					</select>
				</div>
				<button
					className='btn-reset warehouse-btn-reset'
					onClick={resetFilters}
				>
					Сбросить
				</button>
			</div>

			<div
				className='warehouse-table-wrapper'
				style={{
					background: '#fff',
					borderRadius: '8px',
					border: '1px solid #eee',
					overflow: 'hidden',
				}}
			>
				<table
					className='warehouse-main-table'
					style={{
						width: '100%',
						borderCollapse: 'collapse',
						fontSize: '14px',
						textAlign: 'left',
					}}
				>
					<thead>
						<tr
							style={{
								background: '#f9f9f9',
								borderBottom: '2px solid #eee',
								color: '#555',
							}}
						>
							<th style={{ padding: '12px 15px' }}>Наименование</th>
							<th style={{ padding: '12px 15px' }}>Категория</th>
							<th style={{ padding: '12px 15px' }}>Идентификатор</th>
							<th style={{ padding: '12px 15px' }}>Кол-во</th>
							<th style={{ padding: '12px 15px' }}>Город</th>
							<th style={{ padding: '12px 15px' }}>Статус</th>
							<th style={{ padding: '12px 15px' }}>Клиент</th>
							<th style={{ padding: '12px 15px' }}>Гос. номер</th>
							<th style={{ padding: '12px 15px' }}>VIN-код</th>
							<th style={{ padding: '12px 15px', textAlign: 'right' }}>
								Действия
							</th>
						</tr>
					</thead>
					<tbody>
						{loading ? (
							<tr className='warehouse-no-data-row'>
								<td
									colSpan='10'
									style={{ padding: '20px', textAlign: 'center' }}
								>
									Загрузка...
								</td>
							</tr>
						) : viewMode === 'active' && groupedItems.length === 0 ? (
							<tr className='warehouse-no-data-row'>
								<td
									colSpan='10'
									style={{
										padding: '20px',
										textAlign: 'center',
										color: '#888',
									}}
								>
									Оборудование не найдено
								</td>
							</tr>
						) : viewMode === 'trash' && items.length === 0 ? (
							<tr className='warehouse-no-data-row'>
								<td
									colSpan='10'
									style={{
										padding: '20px',
										textAlign: 'center',
										color: '#888',
									}}
								>
									Корзина склада пуста
								</td>
							</tr>
						) : viewMode === 'trash' ? (
							items.map(item => renderWarehouseItemRow(item))
						) : (
							groupedItems.map(categoryGroup => {
								const isCategoryExpanded = Boolean(
									expandedCategories[categoryGroup.category],
								)

								const categoryIsConsumable =
									isConsumableCategoryGroup(categoryGroup)

								return (
									<React.Fragment key={categoryGroup.category}>
										<tr className='warehouse-category-row'>
											<td colSpan='10'>
												<button
													type='button'
													className='warehouse-tree-row warehouse-category-toggle'
													onClick={() => toggleCategory(categoryGroup.category)}
												>
													<span className='warehouse-tree-arrow'>
														{isCategoryExpanded ? '▾' : '▸'}
													</span>

													<span className='warehouse-tree-title'>
														{CATEGORIES[categoryGroup.category] ||
															categoryGroup.category_name ||
															categoryGroup.category}
													</span>

													<span className='warehouse-tree-counts'>
														{formatStatusCounts(
															categoryGroup.counts,
															categoryIsConsumable,
														)}
													</span>
												</button>
											</td>
										</tr>

										{isCategoryExpanded &&
											(categoryGroup.groups || []).map(itemGroup => {
												const groupKey = getItemGroupKey(
													categoryGroup.category,
													itemGroup.group_key,
												)
												const isGroupExpanded = Boolean(
													expandedItemGroups[groupKey],
												)

												return (
													<React.Fragment key={groupKey}>
														<tr className='warehouse-item-group-row'>
															<td colSpan='10'>
																<button
																	type='button'
																	className='warehouse-tree-row warehouse-item-group-toggle'
																	onClick={() =>
																		toggleItemGroup(
																			categoryGroup.category,
																			itemGroup.group_key,
																		)
																	}
																>
																	<span className='warehouse-tree-arrow'>
																		{isGroupExpanded ? '▾' : '▸'}
																	</span>

																	<span className='warehouse-tree-title'>
																		{itemGroup.name}
																	</span>

																	<span className='warehouse-tree-counts'>
																		{formatStatusCounts(
																			itemGroup.counts,
																			itemGroup.is_consumable_group,
																		)}
																	</span>
																</button>
															</td>
														</tr>

														{isGroupExpanded &&
															(itemGroup.items || []).map(item =>
																renderWarehouseItemRow(item),
															)}
													</React.Fragment>
												)
											})}
									</React.Fragment>
								)
							})
						)}
					</tbody>
				</table>
			</div>

			<WarehouseItemModal
				isOpen={isModalOpen}
				editItem={editItem}
				cities={cities}
				onClose={() => {
					setIsModalOpen(false)
					setEditItem(null)
				}}
				onSaved={() => {
					setIsModalOpen(false)
					setEditItem(null)
					fetchItems()
				}}
			/>

			<AttachEquipmentToVehicleModal
				isOpen={Boolean(attachVehicleItem)}
				mode='equipment-first'
				initialWarehouseItem={attachVehicleItem}
				initialWarehouseItemId={attachVehicleItem?.id || null}
				onClose={closeAttachVehicleModal}
				onAttached={handleVehicleEquipmentAttached}
			/>

			{importPreviewOpen && importPreview && (
				<div className='modal-overlay open' onClick={handleCancelImport}>
					<div
						className='modal-window import-preview-modal'
						onClick={e => e.stopPropagation()}
					>
						<div className='modal-header'>
							<span className='modal-title'>Проверка CSV перед импортом</span>

							<button
								className='modal-close'
								type='button'
								onClick={handleCancelImport}
							>
								&times;
							</button>
						</div>

						<div className='import-preview-body'>
							<div className='import-preview-summary'>
								<div>
									<strong>Файл:</strong> {importPreview.fileName}
								</div>

								<div className='import-preview-stats'>
									<div className='import-preview-stat success'>
										Новые: {importPreview.validRows.length}
									</div>
									<div className='import-preview-stat transfer'>
										Перенос серийных: {importPreview.transferRows.length}
									</div>
									<div className='import-preview-stat success'>
										Расходники:{' '}
										{(importPreview.consumableTransferRows?.length || 0) +
											(importPreview.consumableAddRows?.length || 0)}
									</div>
									<div className='import-preview-stat warning'>
										Дубликаты: {importPreview.duplicateRows.length}
									</div>
									<div className='import-preview-stat danger'>
										Ошибки: {importPreview.invalidRows.length}
									</div>
								</div>
							</div>

							<div className='import-city-controls'>
								<label className='warehouse-field'>
									<span className='warehouse-label required'>Из города</span>
									<select
										className='warehouse-input'
										value={importFromCityId}
										onChange={handleImportFromCityChange}
									>
										<option value=''>Выберите город</option>
										{cities.map(city => (
											<option key={city.id} value={city.id}>
												{city.name}
											</option>
										))}
									</select>
								</label>

								<label className='warehouse-field'>
									<span className='warehouse-label required'>В город</span>
									<select
										className='warehouse-input'
										value={importToCityId}
										onChange={handleImportToCityChange}
									>
										<option value=''>Выберите город</option>
										{cities.map(city => (
											<option key={city.id} value={city.id}>
												{city.name}
											</option>
										))}
									</select>
								</label>
							</div>

							<div className='import-preview-columns import-preview-columns-wide'>
								<div className='import-preview-section'>
									<div className='import-preview-section-title success'>
										Новые объекты
									</div>

									{importPreview.validRows.length === 0 ? (
										<div className='import-preview-empty'>
											Нет новых объектов
										</div>
									) : (
										<div className='import-preview-list'>
											{importPreview.validRows.slice(0, 50).map(row => (
												<div key={row.rowNumber} className='import-preview-row'>
													<div className='import-preview-row-title'>
														Строка {row.rowNumber}: {row.name}
													</div>
													<div className='import-preview-row-subtitle'>
														{row.identifier_type}: {row.identifier_value || '—'}
														{row.model ? ` · ${row.model}` : ''}
														{getImportConditionText(row)}
														{' · '}в город {importPreview.toCityName}
													</div>
												</div>
											))}
										</div>
									)}
								</div>

								<div className='import-preview-section'>
									<div className='import-preview-section-title transfer'>
										Перенос серийных
									</div>

									{(importPreview.transferRows || []).length === 0 ? (
										<div className='import-preview-empty'>
											Нет серийных для переноса
										</div>
									) : (
										<div className='import-preview-list'>
											{importPreview.transferRows.slice(0, 50).map(row => (
												<div
													key={row.rowNumber}
													className='import-preview-row transfer'
												>
													<div className='import-preview-row-title'>
														Строка {row.rowNumber}: {row.name}
													</div>
													<div className='import-preview-row-subtitle'>
														{row.identifier_type}: {row.identifier_value || '—'}
													</div>
													<div className='import-preview-row-reason neutral'>
														{row.reason}
														{getImportConditionText(row)}
													</div>
												</div>
											))}
										</div>
									)}
								</div>

								<div className='import-preview-section'>
									<div className='import-preview-section-title success'>
										Расходники
									</div>

									{[
										...(importPreview.consumableTransferRows || []),
										...(importPreview.consumableAddRows || []),
									].length === 0 ? (
										<div className='import-preview-empty'>Нет расходников</div>
									) : (
										<div className='import-preview-list'>
											{[
												...(importPreview.consumableTransferRows || []),
												...(importPreview.consumableAddRows || []),
											]
												.slice(0, 50)
												.map(row => (
													<div
														key={row.rowNumber}
														className='import-preview-row'
													>
														<div className='import-preview-row-title'>
															Строка {row.rowNumber}: {row.name}
														</div>

														<div className='import-preview-row-subtitle'>
															{row.reason}
															{getImportConditionText(row)}
														</div>

														<label className='import-preview-quantity-field'>
															<span>Кол-во:</span>
															<input
																type='number'
																min='1'
																value={row.quantity}
																onChange={e =>
																	handleImportQuantityChange(
																		row.rowNumber,
																		e.target.value,
																	)
																}
															/>
														</label>
													</div>
												))}
										</div>
									)}
								</div>

								<div className='import-preview-section'>
									<div className='import-preview-section-title warning'>
										Дубликаты / ошибки
									</div>

									{[
										...(importPreview.duplicateRows || []),
										...(importPreview.invalidRows || []),
									].length === 0 ? (
										<div className='import-preview-empty'>
											Проблем не найдено
										</div>
									) : (
										<div className='import-preview-list'>
											{[
												...(importPreview.duplicateRows || []),
												...(importPreview.invalidRows || []),
											]
												.slice(0, 50)
												.map(row => (
													<div
														key={`${row.rowNumber}-${row.reason}`}
														className='import-preview-row problem'
													>
														<div className='import-preview-row-title'>
															Строка {row.rowNumber}:{' '}
															{row.name || 'Без названия'}
														</div>
														<div className='import-preview-row-subtitle'>
															{row.identifier_type}:{' '}
															{row.identifier_value || '—'}
														</div>
														<div className='import-preview-row-reason'>
															{row.reason}
														</div>
													</div>
												))}
										</div>
									)}
								</div>
							</div>

							<div className='import-preview-hint'>
								После подтверждения файл будет отправлен на сервер. Если за это
								время кто-то уже добавит такое же оборудование, backend всё
								равно пропустит дубликаты.
							</div>
						</div>

						<div className='modal-footer import-preview-footer'>
							<button
								className='modal-cancel-btn'
								type='button'
								onClick={handleCancelImport}
								disabled={importConfirmLoading}
							>
								Отменить
							</button>

							<button
								className='warehouse-submit-btn'
								type='button'
								onClick={handleConfirmImport}
								disabled={
									importConfirmLoading ||
									!importFromCityId ||
									!importToCityId ||
									(importPreview.validRows.length === 0 &&
										(importPreview.transferRows || []).length === 0 &&
										(importPreview.consumableTransferRows || []).length === 0 &&
										(importPreview.consumableAddRows || []).length === 0)
								}
							>
								{importConfirmLoading
									? 'Импорт...'
									: 'Подтвердить импорт / перенос'}
							</button>
						</div>
					</div>
				</div>
			)}

			{assignItem && (
				<div className='modal-overlay open' onClick={closeAssignModal}>
					<div
						className='modal-window warehouse-transfer-modal'
						onClick={e => e.stopPropagation()}
					>
						<div className='modal-header'>
							<span className='modal-title'>Выдать монтажнику</span>
							<button
								className='modal-close'
								type='button'
								onClick={closeAssignModal}
							>
								&times;
							</button>
						</div>

						<form onSubmit={handleAssignSubmit}>
							<div className='warehouse-transfer-body'>
								<div className='warehouse-transfer-item-card'>
									<div className='warehouse-transfer-item-title'>
										{assignItem.name}
										{assignItem.model ? ` ${assignItem.model}` : ''}
									</div>

									<div className='warehouse-transfer-item-meta'>
										{assignItem.is_serialized ? (
											<>
												{assignItem.identifier_type}:{' '}
												{assignItem.identifier_value}
											</>
										) : (
											<>Расходник · доступно: {assignItem.quantity} шт.</>
										)}

										<span> · </span>

										<span>
											{assignItem.city_name || getCityName(assignItem.city_id)}
										</span>
									</div>
								</div>

								<div className='warehouse-form-grid'>
									<label className='warehouse-field'>
										<span className='warehouse-label required'>Монтажник</span>
										<select
											className='warehouse-input'
											name='target_user_id'
											value={assignForm.target_user_id}
											onChange={handleAssignChange}
											required
										>
											<option value=''>Выберите монтажника</option>

											{technicians.map(tech => (
												<option key={tech.id} value={tech.id}>
													{tech.name} {tech.city ? `· ${tech.city}` : ''}
												</option>
											))}
										</select>
									</label>

									<label className='warehouse-field'>
										<span className='warehouse-label required'>Количество</span>
										<input
											className={`warehouse-input ${
												assignItem.is_serialized
													? 'warehouse-disabled-input'
													: ''
											}`}
											type='number'
											name='quantity'
											min='1'
											max={assignItem.is_serialized ? 1 : assignItem.quantity}
											value={assignItem.is_serialized ? 1 : assignForm.quantity}
											disabled={assignItem.is_serialized}
											onChange={handleAssignChange}
										/>
									</label>

									<label className='warehouse-field warehouse-field-full'>
										<span className='warehouse-label'>Причина</span>
										<input
											className='warehouse-input'
											type='text'
											name='reason'
											value={assignForm.reason}
											onChange={handleAssignChange}
											placeholder='Например: выдано монтажнику для работы'
										/>
									</label>
								</div>
							</div>

							<div className='modal-footer warehouse-modal-footer'>
								<button
									className='modal-cancel-btn'
									type='button'
									onClick={closeAssignModal}
									disabled={assignLoading}
								>
									Отмена
								</button>

								<button
									className='warehouse-submit-btn'
									type='submit'
									disabled={assignLoading}
								>
									{assignLoading ? 'Выдача...' : 'Выдать'}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{transferItem && (
				<div className='modal-overlay open' onClick={closeTransferModal}>
					<div
						className='modal-window warehouse-transfer-modal'
						onClick={e => e.stopPropagation()}
					>
						<div className='modal-header'>
							<span className='modal-title'>Перенос оборудования</span>
							<button
								className='modal-close'
								type='button'
								onClick={closeTransferModal}
							>
								&times;
							</button>
						</div>

						<form onSubmit={handleTransferSubmit}>
							<div className='warehouse-transfer-body'>
								<div className='warehouse-transfer-item-card'>
									<div className='warehouse-transfer-item-title'>
										{transferItem.name}
										{transferItem.model ? ` ${transferItem.model}` : ''}
									</div>

									<div className='warehouse-transfer-item-meta'>
										{transferItem.is_serialized ? (
											<>
												{transferItem.identifier_type}:{' '}
												{transferItem.identifier_value}
											</>
										) : (
											<>Расходник · доступно: {transferItem.quantity} шт.</>
										)}
									</div>
								</div>

								<div className='warehouse-form-grid'>
									<label className='warehouse-field'>
										<span className='warehouse-label required'>Из города</span>
										<select
											className='warehouse-input'
											name='from_city_id'
											value={transferForm.from_city_id}
											onChange={handleTransferChange}
										>
											<option value=''>Выберите город</option>

											{cities.map(city => (
												<option key={city.id} value={city.id}>
													{city.name}
												</option>
											))}
										</select>
									</label>

									<label className='warehouse-field'>
										<span className='warehouse-label required'>В город</span>
										<select
											className='warehouse-input'
											name='to_city_id'
											value={transferForm.to_city_id}
											onChange={handleTransferChange}
										>
											<option value=''>Выберите город</option>

											{cities.map(city => (
												<option key={city.id} value={city.id}>
													{city.name}
												</option>
											))}
										</select>
									</label>

									<label className='warehouse-field'>
										<span className='warehouse-label required'>Количество</span>
										<input
											className={`warehouse-input ${
												transferItem.is_serialized
													? 'warehouse-disabled-input'
													: ''
											}`}
											type='number'
											name='quantity'
											min='1'
											max={
												transferItem.is_serialized ? 1 : transferItem.quantity
											}
											value={
												transferItem.is_serialized ? 1 : transferForm.quantity
											}
											disabled={transferItem.is_serialized}
											onChange={handleTransferChange}
										/>
									</label>

									<label className='warehouse-field'>
										<span className='warehouse-label'>Причина</span>
										<input
											className='warehouse-input'
											type='text'
											name='reason'
											value={transferForm.reason}
											onChange={handleTransferChange}
											placeholder='Например: передано на склад Астана'
										/>
									</label>
								</div>
							</div>

							<div className='modal-footer warehouse-modal-footer'>
								<button
									className='modal-cancel-btn'
									type='button'
									onClick={closeTransferModal}
									disabled={transferLoading}
								>
									Отмена
								</button>

								<button
									className='warehouse-submit-btn'
									type='submit'
									disabled={transferLoading}
								>
									{transferLoading ? 'Перенос...' : 'Перенести'}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{historyItem && (
				<div className='modal-overlay open' onClick={closeHistoryModal}>
					<div
						className='modal-window warehouse-history-modal'
						onClick={e => e.stopPropagation()}
					>
						<div className='modal-header'>
							<span className='modal-title'>История оборудования</span>

							<button
								className='modal-close'
								type='button'
								onClick={closeHistoryModal}
							>
								&times;
							</button>
						</div>

						<div className='warehouse-history-body'>
							<div className='warehouse-history-item-card'>
								<div className='warehouse-history-item-title'>
									{historyItem.name}
									{historyItem.model ? ` ${historyItem.model}` : ''}
								</div>

								<div className='warehouse-history-item-meta'>
									{historyItem.is_serialized ? (
										<>
											{historyItem.identifier_type}:{' '}
											{historyItem.identifier_value}
										</>
									) : (
										<>Расходник · текущее кол-во: {historyItem.quantity} шт.</>
									)}

									<span> · </span>

									<span>
										{historyItem.city_name || getCityName(historyItem.city_id)}
									</span>
								</div>
							</div>

							{historyLoading ? (
								<div className='warehouse-history-empty'>
									Загрузка истории...
								</div>
							) : historyRows.length === 0 ? (
								<div className='warehouse-history-empty'>
									История по этому оборудованию пока пустая
								</div>
							) : (
								<div className='warehouse-history-list'>
									{historyRows.map(row => {
										const movementText = renderHistoryMovementText(row)
										const vehicleText = renderHistoryVehicleText(row)

										return (
											<div key={row.id} className='warehouse-history-row'>
												<div className='warehouse-history-row-dot' />

												<div className='warehouse-history-row-content'>
													<div className='warehouse-history-row-head'>
														<div className='warehouse-history-action'>
															{getHistoryActionLabel(row.action)}
														</div>

														<div className='warehouse-history-date'>
															{formatDateTime(row.created_at)}
														</div>
													</div>

													<div className='warehouse-history-actor'>
														Кто выполнил: {row.created_by_name || '—'}
													</div>

													<div className='warehouse-history-details'>
														{movementText && (
															<div>
																<strong>Город:</strong> {movementText}
															</div>
														)}

														{row.quantity !== null &&
															row.quantity !== undefined && (
																<div>
																	<strong>Количество:</strong> {row.quantity}
																</div>
															)}

														{row.old_status || row.new_status ? (
															<div>
																<strong>Статус:</strong>{' '}
																{STATUSES[row.old_status] ||
																	row.old_status ||
																	'—'}{' '}
																→{' '}
																{STATUSES[row.new_status] ||
																	row.new_status ||
																	'—'}
															</div>
														) : null}

														{row.request_id && (
															<div>
																<strong>Заявка:</strong> #{row.request_id}
																{row.request_city
																	? ` · ${row.request_city}`
																	: ''}
																{row.request_address
																	? ` · ${row.request_address}`
																	: ''}
															</div>
														)}

														{vehicleText && (
															<div>
																<strong>Авто:</strong> {vehicleText}
															</div>
														)}

														{row.from_user_name && (
															<div>
																<strong>От сотрудника:</strong>{' '}
																{row.from_user_name}
															</div>
														)}

														{row.target_user_name && (
															<div>
																<strong>Установил:</strong>{' '}
																{row.target_user_name}
															</div>
														)}

														{row.old_value && (
															<div className='warehouse-history-value'>
																<strong>Изменения:</strong>
																<pre>{row.old_value}</pre>
															</div>
														)}

														{row.reason && (
															<div>
																<strong>Причина:</strong> {row.reason}
															</div>
														)}
													</div>
												</div>
											</div>
										)
									})}
								</div>
							)}
						</div>

						<div className='modal-footer warehouse-modal-footer'>
							<button
								className='modal-cancel-btn'
								type='button'
								onClick={closeHistoryModal}
							>
								Закрыть
							</button>
						</div>
					</div>
				</div>
			)}

			{importResult && (
				<div
					className='modal-overlay open'
					onClick={() => setImportResult(null)}
				>
					<div
						className='modal-window import-result-modal'
						onClick={e => e.stopPropagation()}
					>
						<div className='modal-header'>
							<span className='modal-title'>Результат импорта</span>
							<button
								className='modal-close'
								type='button'
								onClick={() => setImportResult(null)}
							>
								&times;
							</button>
						</div>

						<div className='import-result-body'>
							<textarea
								className='import-result-textarea'
								value={importResult}
								readOnly
							/>

							<div className='import-result-hint'>
								Список можно скопировать и использовать для проверки пропущенных
								устройств.
							</div>
						</div>

						<div className='modal-footer import-result-footer'>
							<button
								className='modal-cancel-btn'
								type='button'
								onClick={() => setImportResult(null)}
							>
								Закрыть
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
