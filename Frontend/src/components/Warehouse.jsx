import React, { useState, useEffect, useRef } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import { useLocation } from 'react-router-dom'
import '../styles/Requests.css'
import '../styles/Warehouse.css'
import WarehouseItemModal from './WarehouseItemModal'

const CATEGORIES = {
	GPS_TRACKER: 'Трекер',
	BEACON: 'Маяк',
	FUEL_SENSOR: 'ДУТ',
	BLE_SENSOR: 'BLE-датчик',
	WIRED_SENSOR: 'Пров. датчик',
	RELAY: 'Реле',
	CABLE: 'Кабель',
	OTHER: 'Другое',
}

const STATUSES = {
	IN_STOCK: 'На складе',
	RESERVED: 'Резерв',
	INSTALLED: 'Установлено',
	WRITTEN_OFF: 'Списано',
}
const STATUS_COLORS = {
	IN_STOCK: '#5e9424',
	RESERVED: '#f57c00',
	INSTALLED: '#1976d2',
	WRITTEN_OFF: '#c62828',
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
	const [transferItem, setTransferItem] = useState(null)
	const [transferForm, setTransferForm] = useState({
		from_city_id: '',
		to_city_id: '',
		quantity: 1,
		reason: '',
	})
	const [transferLoading, setTransferLoading] = useState(false)

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
		fetchCities()
	}, [])

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
			city_id: '',
		})
	}, [location.state?.searchActionId])

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
			const res = await fetch(`${API_BASE_URL}/cities`, {
				headers: getAuthHeaders(),
			})

			if (res.ok) {
				const data = await res.json()
				setCities(
					Array.isArray(data)
						? data.filter(city => city.is_active !== false)
						: [],
				)
			}
		} catch (err) {
			console.error('Ошибка загрузки городов:', err)
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
		setFilters({ search: '', category: '', status: '', city_id: '' })

	const handleDelete = async id => {
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

					return sameCategory && sameName && sameManufacturer && sameModel
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

	const handleTransferChange = e => {
		const { name, value } = e.target

		setTransferForm(prev => ({
			...prev,
			[name]: value,
		}))
	}

	const handleTransferSubmit = async e => {
		e.preventDefault()

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
						<strong>{item.name}</strong>

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
								<button
									className='warehouse-action-btn warehouse-transfer-btn'
									onClick={() => openTransferModal(item)}
									title='Перенести в другой город'
								>
									↔
								</button>

								<button
									className='warehouse-action-btn warehouse-edit-btn'
									onClick={() => openEdit(item)}
									title='Редактировать'
								>
									✎
								</button>

								<button
									className='warehouse-action-btn warehouse-delete-btn'
									onClick={() => handleDelete(item.id)}
									title='Переместить в корзину'
								>
									🗑
								</button>
							</div>
						) : (
							<button
								className='warehouse-restore-btn'
								onClick={() => handleRestore(item.id)}
							>
								Восстановить
							</button>
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
								onClick={() => fileInputRef.current.click()}
								className='warehouse-top-btn btn-import'
							>
								⬆️ Импорт CSV
							</button>

							<button
								className='btn-green warehouse-top-btn btn-add'
								onClick={() => {
									setEditItem(null)
									setIsModalOpen(true)
								}}
							>
								+ Добавить
							</button>
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

						<button
							type='button'
							className={`warehouse-toggle-btn ${viewMode === 'trash' ? 'active' : ''}`}
							onClick={() => setViewMode('trash')}
						>
							Корзина
						</button>
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
					>
						<option value=''>Все города</option>

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