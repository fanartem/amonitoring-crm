import React, { useEffect, useState } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import '../styles/Requests.css'
import '../styles/Warehouse.css'

const CATEGORIES = {
	GPS_TRACKER: 'Трекеры',
	BEACON: 'Маяки',
	FUEL_SENSOR: 'ДУТ',
	BLE_SENSOR: 'BLE-датчики',
	WIRED_SENSOR: 'Проводные датчики',
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

const IDENTIFIER_TYPES = ['IMEI', 'MAC', 'SERIAL', 'NONE', 'OTHER']

const getStatusClassName = status => {
	if (status === 'ASSIGNED_TO_TECH') return 'status-progress'
	if (status === 'INSTALLED' || status === 'USED') return 'status-done'
	if (status === 'REPAIR' || status === 'RESERVED') return 'status-new'
	if (status === 'LOST' || status === 'WRITTEN_OFF') return 'status-cancelled'

	return 'status-new'
}

const getTokenPayload = () => {
	try {
		const token = localStorage.getItem('access_token')
		if (!token) return {}

		const base64Url = token.split('.')[1]
		const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
		const jsonPayload = decodeURIComponent(
			atob(base64)
				.split('')
				.map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
				.join(''),
		)

		return JSON.parse(jsonPayload)
	} catch {
		return {}
	}
}

const buildParams = params => {
	const searchParams = new URLSearchParams()

	Object.entries(params).forEach(([key, value]) => {
		if (value === undefined || value === null || value === '') return
		if (typeof value === 'boolean') {
			if (value) searchParams.append(key, 'true')
			return
		}

		searchParams.append(key, value)
	})

	return searchParams.toString()
}

const getItemQuantity = item => {
	if (Boolean(item.is_serialized)) return 1

	return Number(item.quantity || 0)
}

const getItemIdentity = item => {
	if (item.identifier_value) {
		return `${item.identifier_type || 'ID'}: ${item.identifier_value}`
	}

	if (item.serial_number) {
		return `S/N: ${item.serial_number}`
	}

	return 'Без идентификатора'
}

const normalizeNullable = value => {
	const trimmed = String(value || '').trim()

	return trimmed ? trimmed : null
}

function HistoryModal({ item, history, onClose }) {
	if (!item) return null

	return (
		<div className='modal-overlay open' onClick={onClose}>
			<div
				className='modal-window inventory-modal-wide inventory-history-modal'
				onClick={e => e.stopPropagation()}
			>
				<div className='modal-header'>
					<span className='modal-title'>История предмета</span>

					<button className='modal-close' type='button' onClick={onClose}>
						&times;
					</button>
				</div>

				<div className='inventory-history-title'>
					<strong>{item.name}</strong>
					<span>{getItemIdentity(item)}</span>
				</div>

				{history.length === 0 ? (
					<div className='empty-state'>История пока пустая</div>
				) : (
					<div className='inventory-history-list'>
						{history.map(row => (
							<div key={row.id} className='inventory-history-row'>
								<div className='inventory-history-main'>
									<strong>{row.action}</strong>
									<span>{row.reason || 'Без комментария'}</span>
								</div>

								<div className='inventory-history-meta'>
									<span>
										{row.created_at
											? new Date(row.created_at).toLocaleString('ru-RU')
											: '—'}
									</span>
									<span>Кто: {row.created_by_name || '—'}</span>
									{row.from_user_name && <span>От: {row.from_user_name}</span>}
									{row.target_user_name && (
										<span>Кому: {row.target_user_name}</span>
									)}
									{row.from_city_name && (
										<span>Из города: {row.from_city_name}</span>
									)}
									{row.to_city_name && <span>В город: {row.to_city_name}</span>}
									{row.quantity && <span>Кол-во: {row.quantity}</span>}
									{row.old_status && row.new_status && (
										<span>
											Статус: {STATUSES[row.old_status] || row.old_status} →{' '}
											{STATUSES[row.new_status] || row.new_status}
										</span>
									)}
								</div>
							</div>
						))}
					</div>
				)}

				<div className='modal-footer warehouse-modal-footer'>
					<button className='modal-cancel-btn' type='button' onClick={onClose}>
						Закрыть
					</button>
				</div>
			</div>
		</div>
	)
}

export default function Inventory() {
	const payload = getTokenPayload()
	const userRole = payload.role

	const canManageInventory = ['ADMIN', 'WAREHOUSE_MANAGER'].includes(userRole)
	const canViewInventory = [
		'ADMIN',
		'WAREHOUSE_MANAGER',
		'SENIOR_TECHNICIAN',
	].includes(userRole)
	const canSeeHistory = [
		'ADMIN',
		'WAREHOUSE_MANAGER',
	].includes(userRole)

	const [inventory, setInventory] = useState([])
	const [cities, setCities] = useState([])
	const [technicians, setTechnicians] = useState([])

	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')

	const [expandedUsers, setExpandedUsers] = useState({})
	const [expandedUserCategories, setExpandedUserCategories] = useState({})
	const [expandedGroups, setExpandedGroups] = useState({})

	const [filters, setFilters] = useState({
		search: '',
		city_id: '',
		user_id: '',
		category: '',
		status: '',
		low_stock: false,
	})

	const [historyItem, setHistoryItem] = useState(null)
	const [historyRows, setHistoryRows] = useState([])
	const [historyLoading, setHistoryLoading] = useState(false)

	const [transferItem, setTransferItem] = useState(null)
	const [transferForm, setTransferForm] = useState({
		mode: 'user',
		target_user_id: '',
		to_city_id: '',
		quantity: 1,
		reason: '',
	})

	const [editItem, setEditItem] = useState(null)
	const [editForm, setEditForm] = useState({
		category: 'GPS_TRACKER',
		name: '',
		manufacturer: '',
		model: '',
		identifier_type: 'NONE',
		identifier_value: '',
		serial_number: '',
		is_serialized: true,
		quantity: 1,
		status: 'ASSIGNED_TO_TECH',
		note: '',
	})

	const [manualModalOpen, setManualModalOpen] = useState(false)
	const [manualForm, setManualForm] = useState({
		category: 'TOOLS',
		name: '',
		manufacturer: '',
		model: '',
		identifier_type: 'SERIAL',
		identifier_value: '',
		serial_number: '',
		is_serialized: true,
		quantity: 1,
		city_id: '',
		target_user_id: '',
		note: '',
		reason: '',
	})

	const [thresholdItem, setThresholdItem] = useState(null)
	const [thresholdForm, setThresholdForm] = useState({
		threshold_quantity: 20,
	})

	useEffect(() => {
		if (!canViewInventory) return

		fetchCities()
		fetchTechnicians()
	}, [canViewInventory])

	useEffect(() => {
		if (!canViewInventory) return

		fetchInventory()
	}, [filters, canViewInventory]) // eslint-disable-line react-hooks/exhaustive-deps

	const fetchCities = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/cities`, {
				headers: getAuthHeaders(),
			})

			if (res.ok) {
				const data = await res.json()
				setCities(Array.isArray(data) ? data : [])
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

	const fetchInventory = async () => {
		setLoading(true)
		setError('')

		try {
			const query = buildParams(filters)

			const res = await fetch(`${API_BASE_URL}/warehouse/inventory?${query}`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить инвентарь')
			}

			const data = await res.json()
			setInventory(Array.isArray(data) ? data : [])
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	const fetchHistory = async item => {
		setHistoryItem(item)
		setHistoryRows([])
		setHistoryLoading(true)

		try {
			const res = await fetch(
				`${API_BASE_URL}/warehouse/items/${item.id}/history`,
				{ headers: getAuthHeaders() },
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить историю')
			}

			const data = await res.json()
			setHistoryRows(Array.isArray(data) ? data : [])
		} catch (err) {
			alert(err.message)
			setHistoryItem(null)
		} finally {
			setHistoryLoading(false)
		}
	}

	const handleFilterChange = e => {
		const { name, value, type, checked } = e.target

		setFilters(prev => ({
			...prev,
			[name]: type === 'checkbox' ? checked : value,
		}))
	}

	const resetFilters = () => {
		setFilters({
			search: '',
			city_id: '',
			user_id: '',
			category: '',
			status: '',
			low_stock: false,
		})
	}

	const toggleUser = userKey => {
		setExpandedUsers(prev => ({
			...prev,
			[userKey]: !prev[userKey],
		}))
	}

	const toggleUserCategory = key => {
		setExpandedUserCategories(prev => ({
			...prev,
			[key]: !prev[key],
		}))
	}

	const toggleGroup = groupKey => {
		setExpandedGroups(prev => ({
			...prev,
			[groupKey]: !prev[groupKey],
		}))
	}

	const openTransferModal = item => {
		setTransferItem(item)
		setTransferForm({
			mode: 'user',
			target_user_id: '',
			to_city_id: item.city_id || '',
			quantity: 1,
			reason: '',
		})
	}

	const submitTransfer = async e => {
		e.preventDefault()

		if (!transferItem) return

		try {
			const body = {
				quantity: Number(transferForm.quantity || 1),
				reason: transferForm.reason || null,
			}

			if (transferForm.mode === 'user') {
				if (!transferForm.target_user_id) {
					throw new Error('Выберите монтажника')
				}

				body.target_user_id = Number(transferForm.target_user_id)
			} else {
				if (!transferForm.to_city_id) {
					throw new Error('Выберите город склада')
				}

				body.to_city_id = Number(transferForm.to_city_id)
			}

			const res = await fetch(
				`${API_BASE_URL}/warehouse/inventory/items/${transferItem.id}/transfer`,
				{
					method: 'POST',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify(body),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось выполнить перенос')
			}

			setTransferItem(null)
			fetchInventory()
		} catch (err) {
			alert(err.message)
		}
	}

	const openEditModal = item => {
		const serialized = Boolean(item.is_serialized)

		setEditItem(item)
		setEditForm({
			category: item.category || 'OTHER',
			name: item.name || '',
			manufacturer: item.manufacturer || '',
			model: item.model || '',
			identifier_type: serialized ? item.identifier_type || 'SERIAL' : 'NONE',
			identifier_value: item.identifier_value || '',
			serial_number: item.serial_number || '',
			is_serialized: serialized,
			quantity: item.quantity || 1,
			status: item.status || 'ASSIGNED_TO_TECH',
			note: item.note || '',
		})
	}

	const submitEdit = async e => {
		e.preventDefault()

		if (!editItem) return

		try {
			const serialized = Boolean(editForm.is_serialized)

			const body = {
				category: editForm.category,
				name: editForm.name,
				manufacturer: normalizeNullable(editForm.manufacturer),
				model: normalizeNullable(editForm.model),
				identifier_type: serialized ? editForm.identifier_type : 'NONE',
				identifier_value: serialized
					? normalizeNullable(editForm.identifier_value)
					: null,
				serial_number: serialized
					? normalizeNullable(editForm.serial_number)
					: null,
				is_serialized: serialized,
				quantity: serialized ? 1 : Number(editForm.quantity || 1),
				status: editForm.status,
				note: normalizeNullable(editForm.note),
			}

			const res = await fetch(
				`${API_BASE_URL}/warehouse/items/${editItem.id}`,
				{
					method: 'PATCH',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify(body),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось сохранить изменения')
			}

			setEditItem(null)
			fetchInventory()
		} catch (err) {
			alert(err.message)
		}
	}

	const deleteItem = async item => {
		if (
			!window.confirm(
				`Удалить/переместить в корзину "${item.name}" из инвентаря монтажника?`,
			)
		) {
			return
		}

		try {
			const res = await fetch(`${API_BASE_URL}/warehouse/items/${item.id}`, {
				method: 'DELETE',
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось удалить предмет')
			}

			fetchInventory()
		} catch (err) {
			alert(err.message)
		}
	}

	const submitManualAdd = async e => {
		e.preventDefault()

		try {
			const serialized = Boolean(manualForm.is_serialized)

			const body = {
				category: manualForm.category,
				name: manualForm.name,
				manufacturer: normalizeNullable(manualForm.manufacturer),
				model: normalizeNullable(manualForm.model),
				identifier_type: serialized ? manualForm.identifier_type : 'NONE',
				identifier_value: serialized
					? normalizeNullable(manualForm.identifier_value)
					: null,
				serial_number: serialized
					? normalizeNullable(manualForm.serial_number)
					: null,
				is_serialized: serialized,
				quantity: serialized ? 1 : Number(manualForm.quantity || 1),
				city_id: Number(manualForm.city_id),
				target_user_id: Number(manualForm.target_user_id),
				note: normalizeNullable(manualForm.note),
				reason: normalizeNullable(manualForm.reason),
			}

			const res = await fetch(
				`${API_BASE_URL}/warehouse/inventory/manual-add-to-user`,
				{
					method: 'POST',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify(body),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось добавить предмет')
			}

			setManualModalOpen(false)
			setManualForm({
				category: 'TOOLS',
				name: '',
				manufacturer: '',
				model: '',
				identifier_type: 'SERIAL',
				identifier_value: '',
				serial_number: '',
				is_serialized: true,
				quantity: 1,
				city_id: '',
				target_user_id: '',
				note: '',
				reason: '',
			})
			fetchInventory()
		} catch (err) {
			alert(err.message)
		}
	}

	const openThresholdModal = item => {
		setThresholdItem(item)
		setThresholdForm({
			threshold_quantity: item.threshold_quantity || 20,
		})
	}

	const submitThreshold = async e => {
		e.preventDefault()

		if (!thresholdItem) return

		try {
			const body = {
				city_id: Number(thresholdItem.city_id),
				category: thresholdItem.category,
				name: thresholdItem.name,
				manufacturer: thresholdItem.manufacturer || null,
				model: thresholdItem.model || null,
				threshold_quantity: Number(thresholdForm.threshold_quantity || 20),
			}

			const res = await fetch(
				`${API_BASE_URL}/warehouse/consumable-thresholds`,
				{
					method: 'PATCH',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify(body),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось обновить порог')
			}

			setThresholdItem(null)
			fetchInventory()
		} catch (err) {
			alert(err.message)
		}
	}

	const handleManualChange = e => {
		const { name, value, type, checked } = e.target

		if (name === 'is_serialized') {
			if (checked) {
				setManualForm(prev => ({
					...prev,
					is_serialized: true,
					quantity: 1,
					identifier_type: 'SERIAL',
				}))
			} else {
				setManualForm(prev => ({
					...prev,
					is_serialized: false,
					identifier_type: 'NONE',
					identifier_value: '',
					serial_number: '',
				}))
			}

			return
		}

		setManualForm(prev => ({
			...prev,
			[name]: type === 'checkbox' ? checked : value,
		}))
	}

	const buildInventoryByUsers = source => {
		const usersMap = new Map()

		const normalizeKey = value =>
			String(value || '')
				.trim()
				.toLowerCase()

		const getUserKey = item => String(item.assigned_to_user_id || 'unknown')

		const getItemGroupKey = item =>
			[
				item.category || 'OTHER',
				item.name || '',
				item.manufacturer || '',
				item.model || '',
			]
				.map(normalizeKey)
				.join('|')

			; (source || []).forEach(category => {
				; (category.groups || []).forEach(group => {
					; (group.items || []).forEach(item => {
						const itemQuantity = getItemQuantity(item)
						const userKey = getUserKey(item)

						if (!usersMap.has(userKey)) {
							usersMap.set(userKey, {
								user_key: userKey,
								user_id: item.assigned_to_user_id || null,
								user_name: item.assigned_to_user_name || 'Без монтажника',
								user_city: item.assigned_to_user_city || item.city_name || '',
								total_quantity: 0,
								total_rows: 0,
								categoriesMap: new Map(),
							})
						}

						const userGroup = usersMap.get(userKey)

						userGroup.total_quantity += itemQuantity
						userGroup.total_rows += 1

						const categoryKey = item.category || category.category || 'OTHER'

						if (!userGroup.categoriesMap.has(categoryKey)) {
							userGroup.categoriesMap.set(categoryKey, {
								category: categoryKey,
								category_name: CATEGORIES[categoryKey] || categoryKey,
								total_quantity: 0,
								total_rows: 0,
								groupsMap: new Map(),
							})
						}

						const categoryGroup = userGroup.categoriesMap.get(categoryKey)

						categoryGroup.total_quantity += itemQuantity
						categoryGroup.total_rows += 1

						const itemGroupKey = getItemGroupKey(item)

						if (!categoryGroup.groupsMap.has(itemGroupKey)) {
							categoryGroup.groupsMap.set(itemGroupKey, {
								group_key: itemGroupKey,
								name: item.name || group.name || 'Без наименования',
								manufacturer: item.manufacturer || null,
								model: item.model || null,
								is_consumable_group: !Boolean(item.is_serialized),
								total_quantity: 0,
								total_rows: 0,
								items: [],
							})
						}

						const itemGroup = categoryGroup.groupsMap.get(itemGroupKey)

						itemGroup.total_quantity += itemQuantity
						itemGroup.total_rows += 1

						if (Boolean(item.is_serialized)) {
							itemGroup.is_consumable_group = false
						}

						itemGroup.items.push(item)
					})
				})
			})

		return Array.from(usersMap.values())
			.map(userGroup => {
				const categories = Array.from(userGroup.categoriesMap.values())
					.map(categoryGroup => {
						const groups = Array.from(categoryGroup.groupsMap.values())
							.map(group => ({
								...group,
								items: group.items.sort((a, b) => {
									const statusCompare = String(a.status || '').localeCompare(
										String(b.status || ''),
										'ru',
									)

									if (statusCompare !== 0) return statusCompare

									return Number(b.id || 0) - Number(a.id || 0)
								}),
							}))
							.sort((a, b) => a.name.localeCompare(b.name, 'ru'))

						return {
							...categoryGroup,
							groups,
						}
					})
					.sort((a, b) =>
						String(a.category_name || '').localeCompare(
							String(b.category_name || ''),
							'ru',
						),
					)

				return {
					...userGroup,
					categories,
					categoriesMap: undefined,
				}
			})
			.sort((a, b) => {
				const cityCompare = String(a.user_city || '').localeCompare(
					String(b.user_city || ''),
					'ru',
				)

				if (cityCompare !== 0) return cityCompare

				return String(a.user_name || '').localeCompare(
					String(b.user_name || ''),
					'ru',
				)
			})
	}

	const userInventoryGroups = buildInventoryByUsers(inventory)

	const totalQuantity = userInventoryGroups.reduce(
		(sum, userGroup) => sum + Number(userGroup.total_quantity || 0),
		0,
	)

	if (!canViewInventory) {
		return (
			<div className='requests-page-container'>
				<div className='empty-state'>
					Недостаточно прав для просмотра инвентаря
				</div>
			</div>
		)
	}

	return (
		<div className='requests-page-container'>
			<div className='employees-header inventory-header-row'>
				<div>
					<h2>Инвентарь</h2>
					<p className='employees-subtitle'>
						Инвентарь монтажников по городам, категориям и статусам.
					</p>
				</div>

				{canManageInventory && (
					<button
						className='btn-green'
						onClick={() => setManualModalOpen(true)}
					>
						Добавить монтажнику
					</button>
				)}
			</div>

			<div className='filters-bar'>
				<div className='filter-group filter-main'>
					<label>Поиск</label>
					<input
						className={
							filters.search ? 'filter-input filter-active' : 'filter-input'
						}
						name='search'
						value={filters.search}
						onChange={handleFilterChange}
						placeholder='Название, IMEI, серийник, монтажник...'
					/>
				</div>

				<div className='filter-group'>
					<label>Город</label>
					<select
						className={
							filters.city_id ? 'filter-select filter-active' : 'filter-select'
						}
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

				<div className='filter-group'>
					<label>Монтажник</label>
					<select
						className={
							filters.user_id ? 'filter-select filter-active' : 'filter-select'
						}
						name='user_id'
						value={filters.user_id}
						onChange={handleFilterChange}
					>
						<option value=''>Все монтажники</option>
						{technicians.map(user => (
							<option key={user.id} value={user.id}>
								{user.name} {user.city ? `· ${user.city}` : ''}
							</option>
						))}
					</select>
				</div>

				<div className='filter-group'>
					<label>Категория</label>
					<select
						className={
							filters.category ? 'filter-select filter-active' : 'filter-select'
						}
						name='category'
						value={filters.category}
						onChange={handleFilterChange}
					>
						<option value=''>Все категории</option>
						{Object.entries(CATEGORIES).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</div>

				<div className='filter-group'>
					<label>Статус</label>
					<select
						className={
							filters.status ? 'filter-select filter-active' : 'filter-select'
						}
						name='status'
						value={filters.status}
						onChange={handleFilterChange}
					>
						<option value=''>Все статусы</option>
						{Object.entries(STATUSES).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</div>

				<label
					className={`my-requests-toggle ${filters.low_stock ? 'active' : ''}`}
				>
					<input
						type='checkbox'
						name='low_stock'
						checked={filters.low_stock}
						onChange={handleFilterChange}
					/>
					<span>Низкий остаток</span>
				</label>

				<button className='btn-reset' onClick={resetFilters}>
					Сбросить
				</button>
			</div>

			<div className='requests-count'>
				Всего предметов/единиц: <strong>{totalQuantity}</strong>
			</div>

			{error && <div className='error-message'>{error}</div>}

			{loading ? (
				<div>Загрузка...</div>
			) : userInventoryGroups.length === 0 ? (
				<div className='empty-state'>Инвентарь пуст</div>
			) : (
				<div className='inventory-tree'>
					{userInventoryGroups.map(userGroup => {
						const isUserOpen = expandedUsers[userGroup.user_key] ?? true

						return (
							<div key={userGroup.user_key} className='inventory-user'>
								<div
									className='inventory-user-header'
									onClick={() => toggleUser(userGroup.user_key)}
								>
									<div>
										<strong>
											{isUserOpen ? '▾' : '▸'} {userGroup.user_name}
										</strong>
										<span>
											{userGroup.user_city || 'Город не указан'} ·{' '}
											{userGroup.total_quantity} ед. · {userGroup.total_rows}{' '}
											строк
										</span>
									</div>
								</div>

								{isUserOpen &&
									userGroup.categories.map(category => {
										const userCategoryKey = `${userGroup.user_key}-${category.category}`
										const isCategoryOpen =
											expandedUserCategories[userCategoryKey] ?? true

										return (
											<div key={userCategoryKey} className='inventory-category'>
												<div
													className='inventory-category-header'
													onClick={() => toggleUserCategory(userCategoryKey)}
												>
													<div>
														<strong>
															{isCategoryOpen ? '▾' : '▸'}{' '}
															{CATEGORIES[category.category] ||
																category.category}
														</strong>
														<span>
															{category.total_quantity} ед. ·{' '}
															{category.total_rows} строк
														</span>
													</div>
												</div>

												{isCategoryOpen &&
													category.groups.map(group => {
														const groupKey = `${userGroup.user_key}-${category.category}-${group.group_key}`
														const isGroupOpen = expandedGroups[groupKey] ?? true

														return (
															<div key={groupKey} className='inventory-group'>
																<div
																	className='inventory-group-header'
																	onClick={() => toggleGroup(groupKey)}
																>
																	<div>
																		<strong>
																			{isGroupOpen ? '▾' : '▸'} {group.name}
																		</strong>
																		<span>
																			{group.manufacturer || '—'}{' '}
																			{group.model ? `· ${group.model}` : ''}
																		</span>
																	</div>

																	<div className='inventory-group-count'>
																		{group.total_quantity} ед.
																	</div>
																</div>

																{isGroupOpen && (
																	<div className='inventory-items-list'>
																		{group.items.map(item => (
																			<div
																				key={item.id}
																				className='inventory-item-card'
																			>
																				<div className='inventory-item-main'>
																					<div>
																						<strong>{item.name}</strong>

																						<div className='inventory-item-subtitle'>
																							{item.manufacturer || '—'}{' '}
																							{item.model
																								? `· ${item.model}`
																								: ''}
																						</div>

																						<div className='inventory-item-subtitle'>
																							{getItemIdentity(item)}
																						</div>

																						<div className='inventory-item-subtitle'>
																							Город:{' '}
																							<strong>
																								{item.city_name || '—'}
																							</strong>
																						</div>
																					</div>

																					<div className='inventory-item-badges'>
																						<span
																							className={`status-badge ${getStatusClassName(
																								item.status,
																							)}`}
																						>
																							{STATUSES[item.status] ||
																								item.status}
																						</span>

																						<span className='inventory-qty-badge'>
																							{getItemQuantity(item)} шт.
																						</span>

																						{item.is_low_stock && (
																							<span className='inventory-low-stock'>
																								Низкий остаток
																							</span>
																						)}
																					</div>
																				</div>

																				{item.note && (
																					<div className='inventory-note'>
																						{item.note}
																					</div>
																				)}

																				<div className='inventory-card-actions'>
																					{canSeeHistory && (
																						<button
																							className='btn-details'
																							onClick={() => fetchHistory(item)}
																						>
																							История
																						</button>
																					)}

																					{canManageInventory && (
																						<>
																							<button
																								className='btn-green'
																								onClick={() =>
																									openTransferModal(item)
																								}
																							>
																								Перенос
																							</button>

																							<button
																								className='btn-details'
																								onClick={() =>
																									openEditModal(item)
																								}
																							>
																								Редактировать
																							</button>

																							{!Boolean(item.is_serialized) && (
																								<button
																									className='btn-details'
																									onClick={() =>
																										openThresholdModal(item)
																									}
																								>
																									Порог
																								</button>
																							)}

																							<button
																								className='btn-reset'
																								onClick={() => deleteItem(item)}
																							>
																								Удалить
																							</button>
																						</>
																					)}
																				</div>
																			</div>
																		))}
																	</div>
																)}
															</div>
														)
													})}
											</div>
										)
									})}
							</div>
						)
					})}
				</div>
			)}

			{historyItem && !historyLoading && (
				<HistoryModal
					item={historyItem}
					history={historyRows}
					onClose={() => {
						setHistoryItem(null)
						setHistoryRows([])
					}}
				/>
			)}

			{transferItem && (
				<div
					className='modal-overlay open'
					onClick={() => setTransferItem(null)}
				>
					<form
						className='modal-window inventory-modal-wide inventory-transfer-modal'
						onSubmit={submitTransfer}
						onClick={e => e.stopPropagation()}
					>
						<div className='modal-header'>
							<h3>Перенос предмета</h3>
							<button
								type='button'
								className='modal-close'
								onClick={() => setTransferItem(null)}
							>
								×
							</button>
						</div>

						<div className='inventory-modal-title'>
							<strong>{transferItem.name}</strong>
							<span>{getItemIdentity(transferItem)}</span>
						</div>

						<div className='form-group'>
							<label>Куда перенести</label>
							<select
								value={transferForm.mode}
								onChange={e =>
									setTransferForm(prev => ({
										...prev,
										mode: e.target.value,
										target_user_id: '',
										to_city_id: transferItem.city_id || '',
									}))
								}
							>
								<option value='user'>Другому монтажнику</option>
								<option value='stock'>На склад</option>
							</select>
						</div>

						{transferForm.mode === 'user' ? (
							<div className='form-group'>
								<label>Монтажник</label>
								<select
									value={transferForm.target_user_id}
									onChange={e =>
										setTransferForm(prev => ({
											...prev,
											target_user_id: e.target.value,
										}))
									}
									required
								>
									<option value=''>Выберите монтажника</option>
									{technicians
										.filter(
											user =>
												Number(user.id) !==
												Number(transferItem.assigned_to_user_id),
										)
										.map(user => (
											<option key={user.id} value={user.id}>
												{user.name} {user.city ? `· ${user.city}` : ''}
											</option>
										))}
								</select>
							</div>
						) : (
							<div className='form-group'>
								<label>Город склада</label>
								<select
									value={transferForm.to_city_id}
									onChange={e =>
										setTransferForm(prev => ({
											...prev,
											to_city_id: e.target.value,
										}))
									}
									required
								>
									<option value=''>Выберите город</option>
									{cities.map(city => (
										<option key={city.id} value={city.id}>
											{city.name}
										</option>
									))}
								</select>
							</div>
						)}

						<div className='form-group'>
							<label>Количество</label>
							<input
								type='number'
								min='1'
								max={getItemQuantity(transferItem)}
								value={transferForm.quantity}
								disabled={Boolean(transferItem.is_serialized)}
								onChange={e =>
									setTransferForm(prev => ({
										...prev,
										quantity: e.target.value,
									}))
								}
							/>
						</div>

						<div className='form-group'>
							<label>Комментарий</label>
							<textarea
								value={transferForm.reason}
								onChange={e =>
									setTransferForm(prev => ({
										...prev,
										reason: e.target.value,
									}))
								}
								placeholder='Например: передача другому монтажнику'
							/>
						</div>

						<div className='modal-actions'>
							<button
								type='button'
								className='btn-reset'
								onClick={() => setTransferItem(null)}
							>
								Отмена
							</button>
							<button type='submit' className='btn-green'>
								Перенести
							</button>
						</div>
					</form>
				</div>
			)}

			{editItem && (
				<div className='modal-overlay open' onClick={() => setEditItem(null)}>
					<form
						className='modal-window inventory-modal-wide inventory-edit-modal'
						onSubmit={submitEdit}
						onClick={e => e.stopPropagation()}
					>
						<div className='modal-header'>
							<h3>Редактировать предмет</h3>
							<button
								type='button'
								className='modal-close'
								onClick={() => setEditItem(null)}
							>
								×
							</button>
						</div>

						<div className='form-grid'>
							<div className='form-group'>
								<label>Категория</label>
								<select
									value={editForm.category}
									onChange={e =>
										setEditForm(prev => ({ ...prev, category: e.target.value }))
									}
								>
									{Object.entries(CATEGORIES).map(([value, label]) => (
										<option key={value} value={value}>
											{label}
										</option>
									))}
								</select>
							</div>

							<div className='form-group'>
								<label>Наименование</label>
								<input
									value={editForm.name}
									onChange={e =>
										setEditForm(prev => ({ ...prev, name: e.target.value }))
									}
									required
								/>
							</div>

							<div className='form-group'>
								<label>Производитель</label>
								<input
									value={editForm.manufacturer}
									onChange={e =>
										setEditForm(prev => ({
											...prev,
											manufacturer: e.target.value,
										}))
									}
								/>
							</div>

							<div className='form-group'>
								<label>Модель</label>
								<input
									value={editForm.model}
									onChange={e =>
										setEditForm(prev => ({ ...prev, model: e.target.value }))
									}
								/>
							</div>

							<div className='form-group'>
								<label>Статус</label>
								<select
									value={editForm.status}
									onChange={e =>
										setEditForm(prev => ({ ...prev, status: e.target.value }))
									}
								>
									<option value='ASSIGNED_TO_TECH'>У монтажника</option>
									<option value='REPAIR'>В ремонте</option>
									<option value='LOST'>Потеряно</option>
									<option value='WRITTEN_OFF'>Списано</option>
								</select>
							</div>

							<div className='form-group'>
								<label>Количество</label>
								<input
									type='number'
									min='1'
									value={editForm.quantity}
									disabled={Boolean(editForm.is_serialized)}
									onChange={e =>
										setEditForm(prev => ({
											...prev,
											quantity: e.target.value,
										}))
									}
								/>
							</div>

							{Boolean(editForm.is_serialized) && (
								<>
									<div className='form-group'>
										<label>Тип идентификатора</label>
										<select
											value={editForm.identifier_type}
											onChange={e =>
												setEditForm(prev => ({
													...prev,
													identifier_type: e.target.value,
												}))
											}
										>
											{IDENTIFIER_TYPES.filter(type => type !== 'NONE').map(
												type => (
													<option key={type} value={type}>
														{type}
													</option>
												),
											)}
										</select>
									</div>

									<div className='form-group'>
										<label>Идентификатор</label>
										<input
											value={editForm.identifier_value}
											onChange={e =>
												setEditForm(prev => ({
													...prev,
													identifier_value: e.target.value,
												}))
											}
										/>
									</div>

									<div className='form-group'>
										<label>Серийный номер</label>
										<input
											value={editForm.serial_number}
											onChange={e =>
												setEditForm(prev => ({
													...prev,
													serial_number: e.target.value,
												}))
											}
										/>
									</div>
								</>
							)}

							<div className='form-group form-group-full'>
								<label>Примечание</label>
								<textarea
									value={editForm.note}
									onChange={e =>
										setEditForm(prev => ({ ...prev, note: e.target.value }))
									}
								/>
							</div>
						</div>

						<div className='modal-actions'>
							<button
								type='button'
								className='btn-reset'
								onClick={() => setEditItem(null)}
							>
								Отмена
							</button>
							<button type='submit' className='btn-green'>
								Сохранить
							</button>
						</div>
					</form>
				</div>
			)}

			{manualModalOpen && (
				<div
					className='modal-overlay open'
					onClick={() => setManualModalOpen(false)}
				>
					<form
						className='modal-window inventory-modal-wide inventory-manual-modal'
						onSubmit={submitManualAdd}
						onClick={e => e.stopPropagation()}
					>
						<div className='modal-header'>
							<h3>Добавить предмет монтажнику</h3>
							<button
								type='button'
								className='modal-close'
								onClick={() => setManualModalOpen(false)}
							>
								×
							</button>
						</div>

						<div className='form-grid'>
							<div className='form-group'>
								<label>Монтажник</label>
								<select
									name='target_user_id'
									value={manualForm.target_user_id}
									onChange={handleManualChange}
									required
								>
									<option value=''>Выберите монтажника</option>
									{technicians.map(user => (
										<option key={user.id} value={user.id}>
											{user.name} {user.city ? `· ${user.city}` : ''}
										</option>
									))}
								</select>
							</div>

							<div className='form-group'>
								<label>Город</label>
								<select
									name='city_id'
									value={manualForm.city_id}
									onChange={handleManualChange}
									required
								>
									<option value=''>Выберите город</option>
									{cities.map(city => (
										<option key={city.id} value={city.id}>
											{city.name}
										</option>
									))}
								</select>
							</div>

							<div className='form-group'>
								<label>Категория</label>
								<select
									name='category'
									value={manualForm.category}
									onChange={handleManualChange}
								>
									{Object.entries(CATEGORIES).map(([value, label]) => (
										<option key={value} value={value}>
											{label}
										</option>
									))}
								</select>
							</div>

							<div className='form-group'>
								<label>Наименование</label>
								<input
									name='name'
									value={manualForm.name}
									onChange={handleManualChange}
									required
								/>
							</div>

							<div className='form-group'>
								<label>Производитель</label>
								<input
									name='manufacturer'
									value={manualForm.manufacturer}
									onChange={handleManualChange}
								/>
							</div>

							<div className='form-group'>
								<label>Модель</label>
								<input
									name='model'
									value={manualForm.model}
									onChange={handleManualChange}
								/>
							</div>

							<label className='inventory-checkbox-row'>
								<input
									type='checkbox'
									name='is_serialized'
									checked={manualForm.is_serialized}
									onChange={handleManualChange}
								/>
								<span>Уникальный предмет / оборудование</span>
							</label>

							{Boolean(manualForm.is_serialized) ? (
								<>
									<div className='form-group'>
										<label>Тип идентификатора</label>
										<select
											name='identifier_type'
											value={manualForm.identifier_type}
											onChange={handleManualChange}
										>
											{IDENTIFIER_TYPES.filter(type => type !== 'NONE').map(
												type => (
													<option key={type} value={type}>
														{type}
													</option>
												),
											)}
										</select>
									</div>

									<div className='form-group'>
										<label>Идентификатор</label>
										<input
											name='identifier_value'
											value={manualForm.identifier_value}
											onChange={handleManualChange}
											required
										/>
									</div>

									<div className='form-group'>
										<label>Серийный номер</label>
										<input
											name='serial_number'
											value={manualForm.serial_number}
											onChange={handleManualChange}
										/>
									</div>
								</>
							) : (
								<div className='form-group'>
									<label>Количество</label>
									<input
										type='number'
										min='1'
										name='quantity'
										value={manualForm.quantity}
										onChange={handleManualChange}
										required
									/>
								</div>
							)}

							<div className='form-group form-group-full'>
								<label>Примечание</label>
								<textarea
									name='note'
									value={manualForm.note}
									onChange={handleManualChange}
								/>
							</div>

							<div className='form-group form-group-full'>
								<label>Причина / комментарий для истории</label>
								<textarea
									name='reason'
									value={manualForm.reason}
									onChange={handleManualChange}
									placeholder='Например: ручная выдача аптечки'
								/>
							</div>
						</div>

						<div className='modal-actions'>
							<button
								type='button'
								className='btn-reset'
								onClick={() => setManualModalOpen(false)}
							>
								Отмена
							</button>
							<button type='submit' className='btn-green'>
								Добавить
							</button>
						</div>
					</form>
				</div>
			)}

			{thresholdItem && (
				<div
					className='modal-overlay open'
					onClick={() => setThresholdItem(null)}
				>
					<form
						className='modal-window inventory-modal-wide inventory-threshold-modal'
						onSubmit={submitThreshold}
						onClick={e => e.stopPropagation()}
					>
						<div className='modal-header'>
							<h3>Порог расходника</h3>
							<button
								type='button'
								className='modal-close'
								onClick={() => setThresholdItem(null)}
							>
								×
							</button>
						</div>

						<div className='inventory-modal-title'>
							<strong>{thresholdItem.name}</strong>
							<span>{thresholdItem.city_name || 'Город не указан'}</span>
						</div>

						<div className='form-group'>
							<label>Минимальный остаток</label>
							<input
								type='number'
								min='0'
								value={thresholdForm.threshold_quantity}
								onChange={e =>
									setThresholdForm({
										threshold_quantity: e.target.value,
									})
								}
								required
							/>
						</div>

						<div className='modal-actions'>
							<button
								type='button'
								className='btn-reset'
								onClick={() => setThresholdItem(null)}
							>
								Отмена
							</button>
							<button type='submit' className='btn-green'>
								Сохранить
							</button>
						</div>
					</form>
				</div>
			)}
		</div>
	)
}
