import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import '../styles/RequestEquipmentPanel.css'

const CATEGORIES = {
	GPS_TRACKER: 'Трекер',
	BEACON: 'Маяк',
	FUEL_SENSOR: 'ДУТ',
	BLE_SENSOR: 'BLE-датчик',
	WIRED_SENSOR: 'Проводной датчик',
	RELAY: 'Реле',
	CABLE: 'Кабель',
	CONSUMABLE: 'Расходник',
	TOOLS: 'Инструмент',
	FIRST_AID: 'Аптечка',
	OTHER: 'Другое',
}

const STATUSES = {
	IN_STOCK: 'На складе',
	RESERVED: 'В резерве',
	ASSIGNED_TO_TECH: 'У монтажника',
	INSTALLED: 'Установлено',
	USED: 'Израсходовано',
	REPAIR: 'В ремонте',
	LOST: 'Потеряно',
	WRITTEN_OFF: 'Списано',
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

const getItemTitle = item => {
	const parts = []

	if (item.name) parts.push(item.name)
	if (item.model) parts.push(item.model)

	return parts.join(' ') || 'Оборудование'
}

const getItemIdentifier = item => {
	if (item.identifier_value) {
		return `${item.identifier_type}: ${item.identifier_value}`
	}

	if (item.serial_number) {
		return `S/N: ${item.serial_number}`
	}

	return null
}

const getVehicleTitle = vehicle => {
	if (!vehicle) return 'Автомобиль'

	const title =
		`${vehicle.brand || ''} ${vehicle.model || ''}`.trim() || 'Автомобиль'
	const plate = vehicle.plate_number ? ` · ${vehicle.plate_number}` : ''

	return `${title}${plate}`
}

const getAvailableQuantity = item => {
	if (!item) return 0

	if (Boolean(item.is_serialized)) return 1

	return Number(item.available_quantity || item.quantity || 0)
}

const getSourceLabel = item => {
	if (!item) return ''

	if (item.source_label) return item.source_label

	if (item.assigned_to_user_id) {
		return `Инвентарь: ${item.assigned_to_user_name || '—'}`
	}

	return `Склад: ${item.city_name || '—'}`
}

const getItemOptionTitle = item => {
	const identifier = getItemIdentifier(item)
	const availableQuantity = getAvailableQuantity(item)
	const source = getSourceLabel(item)

	const parts = [
		CATEGORIES[item.category] || item.category,
		getItemTitle(item),
		identifier,
		!item.is_serialized ? `доступно: ${availableQuantity}` : null,
		source,
	].filter(Boolean)

	return parts.join(' — ')
}

export default function RequestEquipmentPanel({ requestId, vehicles = [] }) {
	const payload = getTokenPayload()
	const userRole = String(payload.role || '').toUpperCase()

	const canManageEquipment = ['ADMIN', 'WAREHOUSE_MANAGER'].includes(userRole)

	const canAttachEquipment = [
		'ADMIN',
		'WAREHOUSE_MANAGER',
		'SENIOR_TECHNICIAN',
		'TECHNICIAN',
	].includes(userRole)

	const canDetachEquipment = canManageEquipment

	const [attachedItems, setAttachedItems] = useState([])
	const [availableItems, setAvailableItems] = useState([])
	const [technicians, setTechnicians] = useState([])

	const [selectedRequestVehicleId, setSelectedRequestVehicleId] = useState('')
	const [selectedItemId, setSelectedItemId] = useState('')
	const [quantity, setQuantity] = useState(1)
	const [note, setNote] = useState('')
	const [search, setSearch] = useState('')

	const [selectedTechnicianId, setSelectedTechnicianId] = useState('')
	const [installedByUserId, setInstalledByUserId] = useState('')
	const [includeStock, setIncludeStock] = useState(true)

	const [loading, setLoading] = useState(false)
	const [availableLoading, setAvailableLoading] = useState(false)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState('')

	const vehiclesByRequestVehicleId = useMemo(() => {
		const map = {}

		vehicles.forEach(vehicle => {
			map[String(vehicle.request_vehicle_id)] = vehicle
		})

		return map
	}, [vehicles])

	const selectedItem = availableItems.find(
		item => Number(item.id) === Number(selectedItemId),
	)

	const isSelectedSerialized = selectedItem
		? Boolean(selectedItem.is_serialized)
		: true

	const selectedAvailableQuantity = getAvailableQuantity(selectedItem)

	useEffect(() => {
		if (!requestId) return

		fetchAttachedItems()

		if (canManageEquipment) {
			fetchTechnicians()
		}
	}, [requestId, canManageEquipment])

	useEffect(() => {
		if (vehicles.length === 1 && !selectedRequestVehicleId) {
			setSelectedRequestVehicleId(String(vehicles[0].request_vehicle_id))
		}
	}, [vehicles, selectedRequestVehicleId])

	useEffect(() => {
		if (!canAttachEquipment) return
		if (!selectedRequestVehicleId) {
			setAvailableItems([])
			setSelectedItemId('')
			return
		}

		const timeout = setTimeout(() => {
			fetchAvailableInventory()
		}, 300)

		return () => clearTimeout(timeout)
	}, [
		canAttachEquipment,
		selectedRequestVehicleId,
		search,
		selectedTechnicianId,
		includeStock,
	])

	const fetchAttachedItems = async () => {
		setLoading(true)
		setError('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/warehouse/requests/${requestId}/equipment`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(
					data?.detail || 'Не удалось загрузить оборудование заявки',
				)
			}

			const data = await res.json()
			setAttachedItems(Array.isArray(data) ? data : [])
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
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

	const fetchAvailableInventory = async () => {
		if (!selectedRequestVehicleId) return

		setAvailableLoading(true)

		try {
			const params = new URLSearchParams()

			if (search.trim()) {
				params.append('search', search.trim())
			}

			if (canManageEquipment) {
				params.append('include_stock', includeStock ? 'true' : 'false')

				if (selectedTechnicianId) {
					params.append('assigned_to_user_id', selectedTechnicianId)
				}
			}

			const res = await fetch(
				`${API_BASE_URL}/warehouse/request-vehicles/${selectedRequestVehicleId}/available-inventory?${params.toString()}`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(
					data?.detail || 'Не удалось загрузить доступное оборудование',
				)
			}

			const data = await res.json()
			const rows = Array.isArray(data) ? data : []

			setAvailableItems(rows)

			if (
				selectedItemId &&
				!rows.some(item => Number(item.id) === Number(selectedItemId))
			) {
				setSelectedItemId('')
				setQuantity(1)
				setInstalledByUserId('')
			}
		} catch (err) {
			setError(err.message)
			setAvailableItems([])
		} finally {
			setAvailableLoading(false)
		}
	}

	const handleSelectItem = value => {
		setSelectedItemId(value)
		setQuantity(1)

		const item = availableItems.find(row => Number(row.id) === Number(value))

		if (!item) {
			setInstalledByUserId('')
			return
		}

		if (item.assigned_to_user_id) {
			setInstalledByUserId(String(item.assigned_to_user_id))
			return
		}

		if (canManageEquipment && selectedTechnicianId) {
			setInstalledByUserId(String(selectedTechnicianId))
			return
		}

		setInstalledByUserId('')
	}

	const handleAttach = async () => {
		if (!selectedRequestVehicleId) {
			setError('Выберите автомобиль, к которому нужно привязать оборудование')
			return
		}

		if (!selectedItemId) {
			setError('Выберите оборудование для привязки')
			return
		}

		if (!isSelectedSerialized && Number(quantity) <= 0) {
			setError('Количество должно быть больше 0')
			return
		}

		if (!isSelectedSerialized && Number(quantity) > selectedAvailableQuantity) {
			setError(
				`Недостаточно количества. Доступно: ${selectedAvailableQuantity}`,
			)
			return
		}

		setSaving(true)
		setError('')

		try {
			const requestVehicleId = Number(selectedRequestVehicleId)

			const body = {
				request_vehicle_id: requestVehicleId,
				warehouse_item_id: Number(selectedItemId),
				quantity: isSelectedSerialized ? 1 : Number(quantity),
				note: note.trim() || null,
			}

			if (canManageEquipment && installedByUserId) {
				body.installed_by_user_id = Number(installedByUserId)
			}

			const res = await fetch(
				`${API_BASE_URL}/warehouse/request-vehicles/${requestVehicleId}/equipment`,
				{
					method: 'POST',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify(body),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось привязать оборудование')
			}

			setSelectedItemId('')
			setQuantity(1)
			setNote('')
			setInstalledByUserId('')

			await fetchAttachedItems()
			await fetchAvailableInventory()
		} catch (err) {
			setError(err.message)
		} finally {
			setSaving(false)
		}
	}

	const handleDetach = async linkId => {
		if (
			!window.confirm('Отвязать оборудование от заявки и вернуть на склад?')
		) {
			return
		}

		setSaving(true)
		setError('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/warehouse/requests/${requestId}/equipment/${linkId}`,
				{
					method: 'DELETE',
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось отвязать оборудование')
			}

			await fetchAttachedItems()
			await fetchAvailableInventory()
		} catch (err) {
			setError(err.message)
		} finally {
			setSaving(false)
		}
	}

	const groupedAttachedItems = useMemo(() => {
		const map = {}

		attachedItems.forEach(item => {
			const key = String(item.request_vehicle_id || 'unknown')

			if (!map[key]) {
				map[key] = []
			}

			map[key].push(item)
		})

		return map
	}, [attachedItems])

	return (
		<div className='equipment-panel'>
			<div className='equipment-panel-header'>
				<div>
					<div className='equipment-panel-title'>Оборудование заявки</div>
					<div className='equipment-panel-subtitle'>
						Оборудование привязывается к конкретному автомобилю внутри заявки.
					</div>
				</div>

				<button
					className='equipment-refresh-btn'
					type='button'
					onClick={() => {
						fetchAttachedItems()
						if (canAttachEquipment) fetchAvailableInventory()
					}}
				>
					Обновить
				</button>
			</div>

			{error && <div className='equipment-error'>{error}</div>}

			{canAttachEquipment && (
				<div className='equipment-attach-card'>
					<div className='equipment-section-title'>Привязать оборудование</div>

					<div className='equipment-form-grid'>
						<label className='equipment-field equipment-full'>
							<span>Автомобиль в заявке</span>
							<select
								className='equipment-input'
								value={selectedRequestVehicleId}
								onChange={e => {
									setSelectedRequestVehicleId(e.target.value)
									setSelectedItemId('')
									setQuantity(1)
									setInstalledByUserId('')
								}}
							>
								<option value=''>— выберите автомобиль —</option>

								{vehicles.map(vehicle => (
									<option
										key={vehicle.request_vehicle_id}
										value={vehicle.request_vehicle_id}
									>
										{getVehicleTitle(vehicle)}
									</option>
								))}
							</select>
						</label>

						{canManageEquipment && (
							<>
								<label className='equipment-field'>
									<span>Монтажник / инвентарь</span>
									<select
										className='equipment-input'
										value={selectedTechnicianId}
										onChange={e => {
											setSelectedTechnicianId(e.target.value)
											setSelectedItemId('')
											setQuantity(1)
											setInstalledByUserId(e.target.value)
										}}
									>
										<option value=''>Все монтажники</option>

										{technicians.map(user => (
											<option key={user.id} value={user.id}>
												{user.name} {user.city ? `· ${user.city}` : ''}
											</option>
										))}
									</select>
								</label>

								<label className='equipment-field'>
									<span>Источник</span>
									<label className='equipment-checkbox-row'>
										<input
											type='checkbox'
											checked={includeStock}
											onChange={e => {
												setIncludeStock(e.target.checked)
												setSelectedItemId('')
												setQuantity(1)
											}}
										/>
										<span>Показывать склад IN_STOCK</span>
									</label>
								</label>
							</>
						)}

						<label className='equipment-field equipment-full'>
							<span>
								{canManageEquipment
									? 'Поиск по складу и инвентарю'
									: 'Поиск по моему инвентарю'}
							</span>
							<input
								className='equipment-input'
								type='text'
								value={search}
								onChange={e => setSearch(e.target.value)}
								placeholder='IMEI, MAC, модель, название...'
								disabled={!selectedRequestVehicleId}
							/>
						</label>

						<label className='equipment-field equipment-full'>
							<span>Оборудование</span>
							<select
								className='equipment-input'
								value={selectedItemId}
								onChange={e => handleSelectItem(e.target.value)}
								disabled={!selectedRequestVehicleId || availableLoading}
							>
								<option value=''>
									{!selectedRequestVehicleId
										? '— сначала выберите автомобиль —'
										: availableLoading
											? 'Загрузка оборудования...'
											: '— выберите оборудование —'}
								</option>

								{availableItems.map(item => (
									<option key={item.id} value={item.id}>
										{getItemOptionTitle(item)}
									</option>
								))}
							</select>
						</label>

						{canManageEquipment && (
							<label className='equipment-field equipment-full'>
								<span>Кто установил / монтажник для истории</span>
								<select
									className='equipment-input'
									value={installedByUserId}
									onChange={e => setInstalledByUserId(e.target.value)}
								>
									<option value=''>
										— не указывать, backend определит автоматически —
									</option>

									{technicians.map(user => (
										<option key={user.id} value={user.id}>
											{user.name} {user.city ? `· ${user.city}` : ''}
										</option>
									))}
								</select>
							</label>
						)}

						<label className='equipment-field'>
							<span>Количество</span>
							<input
								className='equipment-input'
								type='number'
								min='1'
								max={selectedItem ? selectedAvailableQuantity : undefined}
								value={isSelectedSerialized ? 1 : quantity}
								disabled={!selectedItemId || isSelectedSerialized}
								onChange={e => setQuantity(e.target.value)}
							/>
						</label>

						<label className='equipment-field'>
							<span>Примечание</span>
							<input
								className='equipment-input'
								type='text'
								value={note}
								onChange={e => setNote(e.target.value)}
								placeholder='Необязательно'
							/>
						</label>
					</div>

					<button
						className='equipment-attach-btn'
						type='button'
						onClick={handleAttach}
						disabled={saving || !selectedItemId || !selectedRequestVehicleId}
					>
						{saving ? 'Привязка...' : 'Привязать к автомобилю'}
					</button>
				</div>
			)}

			<div className='equipment-list-card'>
				<div className='equipment-section-title'>
					Привязанное оборудование ({attachedItems.length})
				</div>

				{loading ? (
					<div className='equipment-empty'>Загрузка...</div>
				) : attachedItems.length === 0 ? (
					<div className='equipment-empty'>
						К этой заявке пока не привязано оборудование
					</div>
				) : (
					<div className='equipment-vehicle-groups'>
						{Object.entries(groupedAttachedItems).map(
							([requestVehicleId, items]) => {
								const vehicle = vehiclesByRequestVehicleId[requestVehicleId]
								const fallbackVehicle = items[0]

								const title = vehicle
									? getVehicleTitle(vehicle)
									: `${fallbackVehicle.brand || ''} ${fallbackVehicle.vehicle_model || ''} ${
											fallbackVehicle.plate_number
												? `· ${fallbackVehicle.plate_number}`
												: ''
										}`.trim() || 'Автомобиль'

								return (
									<div
										key={requestVehicleId}
										className='equipment-vehicle-group'
									>
										<div className='equipment-vehicle-title'>{title}</div>

										<div className='equipment-list'>
											{items.map(item => (
												<div key={item.link_id} className='equipment-item'>
													<div className='equipment-item-main'>
														<div className='equipment-item-title'>
															{CATEGORIES[item.category] || item.category} ·{' '}
															{getItemTitle(item)}
														</div>

														<div className='equipment-item-meta'>
															{getItemIdentifier(item) && (
																<span>{getItemIdentifier(item)}</span>
															)}

															<span>Кол-во: {item.quantity}</span>

															{item.status && (
																<span>
																	{STATUSES[item.status] || item.status}
																</span>
															)}
														</div>

														<div className='equipment-item-meta'>
															<span>
																Привязал: {item.attached_by_name || '—'}
															</span>
															<span>
																{item.attached_at
																	? new Date(item.attached_at).toLocaleString(
																			'ru-RU',
																		)
																	: 'Дата не указана'}
															</span>
														</div>

														{item.note && (
															<div className='equipment-item-note'>
																{item.note}
															</div>
														)}
													</div>

													{canDetachEquipment && (
														<button
															className='equipment-detach-btn'
															type='button'
															onClick={() => handleDetach(item.link_id)}
															disabled={saving}
														>
															Отвязать
														</button>
													)}
												</div>
											))}
										</div>
									</div>
								)
							},
						)}
					</div>
				)}
			</div>
		</div>
	)
}
