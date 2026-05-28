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
	OTHER: 'Другое',
}

const STATUSES = {
	IN_STOCK: 'На складе',
	RESERVED: 'В резерве',
	INSTALLED: 'Установлено',
	WRITTEN_OFF: 'Списано',
}

const getUserRole = () => {
	try {
		const token = localStorage.getItem('access_token')
		if (!token) return null

		const payload = JSON.parse(atob(token.split('.')[1]))
		return payload.role
	} catch {
		return null
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

export default function RequestEquipmentPanel({ requestId, vehicles = [] }) {
	const [attachedItems, setAttachedItems] = useState([])
	const [warehouseItems, setWarehouseItems] = useState([])
	const [selectedRequestVehicleId, setSelectedRequestVehicleId] = useState('')
	const [selectedItemId, setSelectedItemId] = useState('')
	const [quantity, setQuantity] = useState(1)
	const [note, setNote] = useState('')
	const [search, setSearch] = useState('')
	const [loading, setLoading] = useState(false)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState('')

	const userRole = getUserRole()
	const canManageEquipment =
		userRole === 'ADMIN' || userRole === 'WAREHOUSE_MANAGER'

	const vehiclesByRequestVehicleId = useMemo(() => {
		const map = {}

		vehicles.forEach(vehicle => {
			map[String(vehicle.request_vehicle_id)] = vehicle
		})

		return map
	}, [vehicles])

	useEffect(() => {
		if (!requestId) return

		fetchAttachedItems()

		if (canManageEquipment) {
			fetchWarehouseItems()
		}
	}, [requestId, canManageEquipment])

	useEffect(() => {
		if (vehicles.length === 1 && !selectedRequestVehicleId) {
			setSelectedRequestVehicleId(String(vehicles[0].request_vehicle_id))
		}
	}, [vehicles, selectedRequestVehicleId])

	useEffect(() => {
		if (!canManageEquipment) return

		const timeout = setTimeout(() => {
			fetchWarehouseItems()
		}, 300)

		return () => clearTimeout(timeout)
	}, [search])

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

	const fetchWarehouseItems = async () => {
		try {
			const params = new URLSearchParams()
			params.append('status', 'IN_STOCK')

			if (search.trim()) {
				params.append('search', search.trim())
			}

			const res = await fetch(
				`${API_BASE_URL}/warehouse/items?${params.toString()}`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (res.ok) {
				const data = await res.json()
				setWarehouseItems(Array.isArray(data) ? data : [])
			}
		} catch (err) {
			console.error('Ошибка загрузки склада:', err)
		}
	}

	const selectedItem = warehouseItems.find(
		item => item.id === Number(selectedItemId),
	)

	const isSelectedSerialized = selectedItem
		? Boolean(selectedItem.is_serialized)
		: true

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

		setSaving(true)
		setError('')

		try {
			const requestVehicleId = Number(selectedRequestVehicleId)

			const res = await fetch(
				`${API_BASE_URL}/warehouse/request-vehicles/${requestVehicleId}/equipment`,
				{
					method: 'POST',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({
						request_vehicle_id: requestVehicleId,
						warehouse_item_id: Number(selectedItemId),
						quantity: isSelectedSerialized ? 1 : Number(quantity),
						note: note.trim() || null,
					}),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось привязать оборудование')
			}

			setSelectedItemId('')
			setQuantity(1)
			setNote('')

			await fetchAttachedItems()
			await fetchWarehouseItems()
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
			await fetchWarehouseItems()
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
						if (canManageEquipment) fetchWarehouseItems()
					}}
				>
					Обновить
				</button>
			</div>

			{error && <div className='equipment-error'>{error}</div>}

			{canManageEquipment && (
				<div className='equipment-attach-card'>
					<div className='equipment-section-title'>Привязать оборудование</div>

					<div className='equipment-form-grid'>
						<label className='equipment-field equipment-full'>
							<span>Автомобиль в заявке</span>
							<select
								className='equipment-input'
								value={selectedRequestVehicleId}
								onChange={e => setSelectedRequestVehicleId(e.target.value)}
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

						<label className='equipment-field equipment-full'>
							<span>Поиск на складе</span>
							<input
								className='equipment-input'
								type='text'
								value={search}
								onChange={e => setSearch(e.target.value)}
								placeholder='IMEI, MAC, модель, название...'
							/>
						</label>

						<label className='equipment-field equipment-full'>
							<span>Оборудование</span>
							<select
								className='equipment-input'
								value={selectedItemId}
								onChange={e => {
									setSelectedItemId(e.target.value)
									setQuantity(1)
								}}
							>
								<option value=''>— выберите оборудование —</option>

								{warehouseItems.map(item => (
									<option key={item.id} value={item.id}>
										{CATEGORIES[item.category] || item.category} —{' '}
										{getItemTitle(item)}
										{getItemIdentifier(item)
											? ` — ${getItemIdentifier(item)}`
											: ''}
										{!item.is_serialized ? ` — доступно: ${item.quantity}` : ''}
									</option>
								))}
							</select>
						</label>

						<label className='equipment-field'>
							<span>Количество</span>
							<input
								className='equipment-input'
								type='number'
								min='1'
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
									: `${fallbackVehicle.brand || ''} ${fallbackVehicle.vehicle_model || ''} ${fallbackVehicle.plate_number ? `· ${fallbackVehicle.plate_number}` : ''}`.trim() ||
										'Автомобиль'

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

													{canManageEquipment && (
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
