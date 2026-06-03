import React, { useState, useEffect, useRef } from 'react'
import { API_BASE_URL, getAuthHeaders } from '../api'
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
	const [loading, setLoading] = useState(false)
	const [filters, setFilters] = useState({
		search: '',
		category: '',
		status: '',
	})
	const [viewMode, setViewMode] = useState('active') // active | trash

	const [isModalOpen, setIsModalOpen] = useState(false)
	const [editItem, setEditItem] = useState(null)
	const [importResult, setImportResult] = useState(null)
	const [pendingImportFile, setPendingImportFile] = useState(null)
	const [importPreview, setImportPreview] = useState(null)
	const [importPreviewOpen, setImportPreviewOpen] = useState(false)
	const [importConfirmLoading, setImportConfirmLoading] = useState(false)

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

	const fetchItems = async () => {
		setLoading(true)
		try {
			const params = new URLSearchParams()
			if (filters.category) params.append('category', filters.category)
			if (filters.status) params.append('status', filters.status)
			if (filters.search) params.append('search', filters.search)

			const res = await fetch(
				`${API_BASE_URL}/warehouse/items?${params.toString()}`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (res.ok) {
				setItems(await res.json())
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
		setFilters({ search: '', category: '', status: '' })

	const handleDelete = async id => {
		if (!window.confirm('Переместить оборудование в корзину?')) return

		try {
			const res = await fetch(`${API_BASE_URL}/warehouse/items/${id}`, {
				method: 'DELETE',
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const err = await res.json()
				throw new Error(err.detail)
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
			const preview = await buildImportPreview(file)

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

		setImportConfirmLoading(true)

		const formData = new FormData()
		formData.append('file', pendingImportFile)

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

	const buildImportPreview = async file => {
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

				duplicateRows.push({
					...itemPreview,
					reason: 'Уже есть на складе',
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

			if (key) {
				fileKeys.set(key, rowInfo.rowNumber)
			}

			validRows.push(itemPreview)
		})

		return {
			fileName: file.name,
			totalRows: rows.length,
			validRows,
			duplicateRows,
			invalidRows,
		}
	}

	const buildImportMessage = data => {
		const lines = []

		lines.push(`Добавлено: ${data.imported_count || 0}`)

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
			<div className='clients-header-bar warehouse-header-bar' style={{ marginBottom: '15px' }}>
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

			<div className='filters-bar warehouse-filters' style={{ marginBottom: '20px' }}>
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
				<button className='btn-reset warehouse-btn-reset' onClick={resetFilters}>
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
							<th style={{ padding: '12px 15px' }}>Статус</th>
							<th style={{ padding: '12px 15px' }}>Клиент</th>
							<th style={{ padding: '12px 15px' }}>Гос. номер</th>
							<th style={{ padding: '12px 15px' }}>VIN-код</th>
							<th style={{ padding: '12px 15px', textAlign: 'right' }}>Действия</th>
						</tr>
					</thead>
					<tbody>
						{loading ? (
							<tr className='warehouse-no-data-row'>
								<td
									colSpan='9'
									style={{ padding: '20px', textAlign: 'center' }}
								>
									Загрузка...
								</td>
							</tr>
						) : items.length === 0 ? (
							<tr className='warehouse-no-data-row'>
								<td
									colSpan='9'
									style={{
										padding: '20px',
										textAlign: 'center',
										color: '#888',
									}}
								>
									{viewMode === 'active'
										? 'Оборудование не найдено'
										: 'Корзина склада пуста'}
								</td>
							</tr>
						) : (
							items.map(item => (
								<tr
									key={item.id}
									ref={el => {
										itemRefs.current[Number(item.id)] = el
									}}
									className={
										Number(highlightedItemId) === Number(item.id)
											? 'warehouse-item-highlighted'
											: ''
									}
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
													{item.deleted_by_name
														? ` · ${item.deleted_by_name}`
														: ''}
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
												<span style={{ color: '#aaa', fontSize: '12px' }}>
													Расходник
												</span>
											)}
										</div>
									</td>
									<td style={{ padding: '12px 15px', fontWeight: 'bold' }}>
										<div className='cell-value'>
											{item.quantity} шт.
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
										<div className='cell-value'>
											{renderClientInfo(item)}
										</div>
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
										<div className='cell-value'>
											{renderCarInfo(item, 'vin')}
										</div>
									</td>

									<td style={{ padding: '12px 15px', textAlign: 'right' }}>
										<div className='cell-value warehouse-cell-actions'>
											{viewMode === 'active' ? (
												<div className='warehouse-actions'>
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
							))
						)}
					</tbody>
				</table>
			</div>

			<WarehouseItemModal
				isOpen={isModalOpen}
				editItem={editItem}
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
										К импорту: {importPreview.validRows.length}
									</div>
									<div className='import-preview-stat warning'>
										Уже существуют: {importPreview.duplicateRows.length}
									</div>
									<div className='import-preview-stat danger'>
										Ошибки: {importPreview.invalidRows.length}
									</div>
								</div>
							</div>

							<div className='import-preview-columns'>
								<div className='import-preview-section'>
									<div className='import-preview-section-title success'>
										Будут импортированы
									</div>

									{importPreview.validRows.length === 0 ? (
										<div className='import-preview-empty'>
											Нет строк для импорта
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
													</div>
												</div>
											))}

											{importPreview.validRows.length > 50 && (
												<div className='import-preview-more'>
													Показаны первые 50 строк из{' '}
													{importPreview.validRows.length}
												</div>
											)}
										</div>
									)}
								</div>

								<div className='import-preview-section'>
									<div className='import-preview-section-title warning'>
										Не будут импортированы
									</div>

									{importPreview.duplicateRows.length === 0 &&
									importPreview.invalidRows.length === 0 ? (
										<div className='import-preview-empty'>
											Проблем не найдено
										</div>
									) : (
										<div className='import-preview-list'>
											{[
												...importPreview.duplicateRows,
												...importPreview.invalidRows,
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

											{importPreview.duplicateRows.length +
												importPreview.invalidRows.length >
												50 && (
												<div className='import-preview-more'>
													Показаны первые 50 проблемных строк
												</div>
											)}
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
									importConfirmLoading || importPreview.validRows.length === 0
								}
							>
								{importConfirmLoading
									? 'Импорт...'
									: `Подтвердить импорт (${importPreview.validRows.length})`}
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