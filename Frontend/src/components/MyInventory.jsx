import React, { useEffect, useState } from 'react'
import { API_BASE_URL, getAuthHeaders } from '../api'
import { getStoredUser, hasAnyPermission } from '../utils/access'
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

// Иконка на заголовок каждой категории — помогает узнавать раздел с одного взгляда,
// не читая текст целиком.
const CATEGORY_ICONS = {
	GPS_TRACKER: 'fa-satellite-dish',
	BEACON: 'fa-tower-broadcast',
	FUEL_SENSOR: 'fa-gas-pump',
	BLE_SENSOR: 'fa-wifi',
	WIRED_SENSOR: 'fa-plug',
	RELAY: 'fa-toggle-on',
	CABLE: 'fa-ethernet',
	CONSUMABLE: 'fa-box',
	TOOLS: 'fa-screwdriver-wrench',
	FIRST_AID: 'fa-kit-medical',
	OTHER: 'fa-cube',
}

const getStatusClassName = status => {
	if (status === 'ASSIGNED_TO_TECH') return 'status-progress'
	if (status === 'INSTALLED' || status === 'USED') return 'status-done'
	if (status === 'REPAIR' || status === 'RESERVED') return 'status-new'
	if (status === 'LOST' || status === 'WRITTEN_OFF') return 'status-cancelled'

	return 'status-new'
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

function HistoryModal({ item, history, loading, onClose }) {
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

				{loading ? (
					<div className='empty-state'>Загрузка истории...</div>
				) : history.length === 0 ? (
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

export default function MyInventory() {
	const currentUser = getStoredUser()

	// Совпадает с MY_INVENTORY_VIEW_PERMISSION_CODES в warehouse.py.
	const canViewMyInventory = hasAnyPermission(currentUser, [
		'warehouse.my_inventory.view',
		'warehouse.inventory.view_own',
	])

	// Все предметы на этой странице — свои, а историю своего предмета
	// владелец видит всегда (см. get_warehouse_item_history).
	const canViewMyInventoryHistory = canViewMyInventory

	const [inventory, setInventory] = useState([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')

	const [expandedCategories, setExpandedCategories] = useState({})
	const [expandedGroups, setExpandedGroups] = useState({})

	const [filters, setFilters] = useState({
		search: '',
		category: '',
		status: '',
		low_stock: false,
	})

	// Текст поиска вводится сразу, но в filters.search попадает с задержкой
	// (debounce) — иначе запрос на сервер улетал бы на каждое нажатие клавиши.
	const [searchInput, setSearchInput] = useState('')

	// Панель фильтров на мобилке свёрнута по умолчанию — разворачивается
	// по кнопке, чтобы не занимать экран постоянно (тот же паттерн, что
	// и на вкладке "Заявки"/"Инвентарь").
	const [showMobileFilters, setShowMobileFilters] = useState(false)

	const [historyItem, setHistoryItem] = useState(null)
	const [historyRows, setHistoryRows] = useState([])
	const [historyLoading, setHistoryLoading] = useState(false)

	useEffect(() => {
		if (!canViewMyInventory) return

		fetchInventory()
	}, [filters, canViewMyInventory]) // eslint-disable-line react-hooks/exhaustive-deps

	// Debounce: применяем введённый текст поиска к filters.search
	// через паузу в наборе, чтобы не дёргать сервер на каждую букву.
	useEffect(() => {
		const timeoutId = setTimeout(() => {
			setFilters(prev => {
				const trimmed = searchInput.trim()
				if (prev.search === trimmed) return prev
				return { ...prev, search: trimmed }
			})
		}, 400)

		return () => clearTimeout(timeoutId)
	}, [searchInput])

	const fetchInventory = async () => {
		setLoading(true)
		setError('')

		try {
			const query = buildParams(filters)

			const res = await fetch(
				`${API_BASE_URL}/warehouse/inventory/my?${query}`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить мой инвентарь')
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
		if (!canViewMyInventoryHistory) {
			alert('Недостаточно прав для просмотра истории')
			return
		}

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

	const closeHistoryModal = () => {
		setHistoryItem(null)
		setHistoryRows([])
		setHistoryLoading(false)
	}

	const handleFilterChange = e => {
		const { name, value, type, checked } = e.target

		setFilters(prev => ({
			...prev,
			[name]: type === 'checkbox' ? checked : value,
		}))
	}

	const resetFilters = () => {
		setSearchInput('')
		setFilters({
			search: '',
			category: '',
			status: '',
			low_stock: false,
		})
	}

	const toggleCategory = category => {
		setExpandedCategories(prev => ({
			...prev,
			[category]: !prev[category],
		}))
	}

	const toggleGroup = groupKey => {
		setExpandedGroups(prev => ({
			...prev,
			[groupKey]: !prev[groupKey],
		}))
	}

	const totalQuantity = inventory.reduce(
		(sum, category) => sum + Number(category.total_quantity || 0),
		0,
	)

	// Для бейджа на кнопке "Фильтры" на мобилке.
	const activeFiltersCount =
		(searchInput ? 1 : 0) +
		Object.entries(filters).filter(
			([key, value]) => key !== 'search' && Boolean(value),
		).length

	if (!canViewMyInventory) {
		return (
			<div className='requests-page-container'>
				<div className='empty-state'>
					Недостаточно прав для просмотра моего инвентаря
				</div>
			</div>
		)
	}

	return (
		<div className='requests-page-container'>
			<div className='employees-header'>
				<h2>Мой инвентарь</h2>
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
				<div className='filters-bar inventory-filters'>
					<div className='filter-group filter-main'>
						<label>Поиск</label>
						<input
							className={
								searchInput ? 'filter-input filter-active' : 'filter-input'
							}
							name='search'
							value={searchInput}
							onChange={e => setSearchInput(e.target.value)}
							placeholder='Название, IMEI, серийник...'
						/>
					</div>

					<div className='filter-group'>
						<label>Категория</label>
						<select
							className={
								filters.category
									? 'filter-select filter-active'
									: 'filter-select'
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
			</div>

			<div className='requests-count'>
				Всего предметов/единиц: <strong>{totalQuantity}</strong>
			</div>

			{error && <div className='error-message'>{error}</div>}

			{loading ? (
				<div>Загрузка...</div>
			) : inventory.length === 0 ? (
				<div className='empty-state'>Инвентарь пуст</div>
			) : (
				<div className='inventory-tree'>
					{inventory.map(category => {
						// У монтажника собственный инвентарь всегда развёрнут по умолчанию.
						const isCategoryOpen = expandedCategories[category.category] ?? true

						return (
							<div key={category.category} className='inventory-category'>
								<button
									type='button'
									className={`inventory-category-header ${
										isCategoryOpen ? 'is-open' : ''
									}`}
									onClick={() => toggleCategory(category.category)}
									aria-expanded={isCategoryOpen}
								>
									<span className='inventory-row-left'>
										<i
											className='fa-solid fa-chevron-right inventory-chevron'
											aria-hidden='true'
										></i>

										<span className='inventory-category-icon'>
											<i
												className={`fa-solid ${
													CATEGORY_ICONS[category.category] || 'fa-cube'
												}`}
											></i>
										</span>

										<span className='inventory-row-heading'>
											<strong>
												{CATEGORIES[category.category] || category.category}
											</strong>
										</span>
									</span>

									<span className='inventory-row-stats'>
										<span className='inventory-pill'>
											{category.total_quantity} ед.
										</span>
									</span>
								</button>

								{isCategoryOpen && (
									<div className='inventory-category-body inventory-reveal'>
										{category.groups.map(group => {
											const groupKey = `${category.category}-${group.group_key}`
											const isGroupOpen = expandedGroups[groupKey] ?? true

											return (
												<div key={groupKey} className='inventory-group'>
													<button
														type='button'
														className={`inventory-group-header ${
															isGroupOpen ? 'is-open' : ''
														}`}
														onClick={() => toggleGroup(groupKey)}
														aria-expanded={isGroupOpen}
													>
														<span className='inventory-row-left'>
															<i
																className='fa-solid fa-chevron-right inventory-chevron'
																aria-hidden='true'
															></i>

															<span className='inventory-row-heading'>
																<strong>{group.name}</strong>
																<span className='inventory-row-meta'>
																	{group.manufacturer || '—'}{' '}
																	{group.model ? `· ${group.model}` : ''}
																</span>
															</span>
														</span>

														<span className='inventory-pill'>
															{group.total_quantity} ед.
														</span>
													</button>

													{isGroupOpen && (
														<div className='inventory-items-list inventory-reveal'>
															{group.items.map(item => (
																<div
																	key={item.id}
																	className={`inventory-item-card ${getStatusClassName(
																		item.status,
																	)}`}
																>
																	<div className='inventory-item-main'>
																		<div>
																			<strong>{item.name}</strong>

																			<div className='inventory-item-subtitle'>
																				{item.manufacturer || '—'}{' '}
																				{item.model ? `· ${item.model}` : ''}
																			</div>

																			<div className='inventory-item-subtitle'>
																				{getItemIdentity(item)}
																			</div>
																		</div>

																		<div className='inventory-item-badges'>
																			<span
																				className={`status-badge ${getStatusClassName(
																					item.status,
																				)}`}
																			>
																				{STATUSES[item.status] || item.status}
																			</span>

																			<span className='inventory-qty-badge'>
																				{getItemQuantity(item)} шт.
																			</span>

																			{item.is_low_stock && (
																				<span className='inventory-low-stock'>
																					<i className='fa-solid fa-triangle-exclamation'></i>{' '}
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

																	{canViewMyInventoryHistory && (
																		<div className='inventory-card-actions'>
																			<button
																				className='btn-details'
																				type='button'
																				onClick={() => fetchHistory(item)}
																			>
																				История
																			</button>
																		</div>
																	)}
																</div>
															))}
														</div>
													)}
												</div>
											)
										})}
									</div>
								)}
							</div>
						)
					})}
				</div>
			)}

			{historyItem && (
				<HistoryModal
					item={historyItem}
					history={historyRows}
					loading={historyLoading}
					onClose={closeHistoryModal}
				/>
			)}
		</div>
	)
}
