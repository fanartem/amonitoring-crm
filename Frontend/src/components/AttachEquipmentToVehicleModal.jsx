import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import '../styles/Warehouse.css'

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

const isSerializedItem = item => {
	return item?.is_serialized === true || Number(item?.is_serialized) === 1
}

const getAvailableQuantity = item => {
	if (!item) return 1
	if (isSerializedItem(item)) return 1

	return Number(item.available_quantity ?? item.quantity ?? 0)
}

const getItemTitle = item => {
	if (!item) return 'Оборудование не выбрано'

	const title = [item.name, item.manufacturer, item.model]
		.filter(Boolean)
		.join(' ')
		.trim()

	return title || `Оборудование #${item.id}`
}

const getItemIdentifierText = item => {
	if (!item) return '—'

	if (isSerializedItem(item)) {
		const type = item.identifier_type || 'ID'
		const value = item.identifier_value || item.serial_number || '—'

		return `${type}: ${value}`
	}

	return `Расходник · доступно: ${getAvailableQuantity(item)} шт.`
}

const getVehicleTitle = vehicle => {
	if (!vehicle) return 'Авто не выбрано'

	const title = [vehicle.brand, vehicle.model].filter(Boolean).join(' ').trim()
	const details = []

	if (vehicle.plate_number) details.push(vehicle.plate_number)
	if (vehicle.vin) details.push(`VIN: ${vehicle.vin}`)

	return `${title || 'Авто'}${details.length ? ` · ${details.join(' · ')}` : ''}`
}

const getClientTitle = vehicle => {
	if (!vehicle) return '—'

	return (
		vehicle.company_name ||
		vehicle.client_company_name ||
		vehicle.client_name ||
		vehicle.name ||
		'Клиент не указан'
	)
}

export default function AttachEquipmentToVehicleModal({
	isOpen,
	mode = 'equipment-first',

	initialWarehouseItem = null,
	initialWarehouseItemId = null,

	initialVehicle = null,
	initialVehicleId = null,

	onClose,
	onAttached,
}) {
	const [selectedWarehouseItem, setSelectedWarehouseItem] = useState(null)
	const [selectedVehicle, setSelectedVehicle] = useState(null)

	const [equipmentSearch, setEquipmentSearch] = useState('')
	const [equipmentResults, setEquipmentResults] = useState([])
	const [equipmentSearchLoading, setEquipmentSearchLoading] = useState(false)

	const [vehicleSearch, setVehicleSearch] = useState('')
	const [vehicleResults, setVehicleResults] = useState([])
	const [vehicleSearchLoading, setVehicleSearchLoading] = useState(false)

	const [quantity, setQuantity] = useState(1)
	const [note, setNote] = useState('')
	const [submitLoading, setSubmitLoading] = useState(false)

	const equipmentLocked = mode === 'equipment-first'
	const vehicleLocked = mode === 'vehicle-first'

	const maxQuantity = useMemo(() => {
		return getAvailableQuantity(selectedWarehouseItem)
	}, [selectedWarehouseItem])

	useEffect(() => {
		if (!isOpen) {
			setSelectedWarehouseItem(null)
			setSelectedVehicle(null)
			setEquipmentSearch('')
			setEquipmentResults([])
			setVehicleSearch('')
			setVehicleResults([])
			setQuantity(1)
			setNote('')
			setSubmitLoading(false)
			return
		}

		if (initialWarehouseItem) {
			setSelectedWarehouseItem(initialWarehouseItem)
			setQuantity(isSerializedItem(initialWarehouseItem) ? 1 : 1)
		}

		if (initialVehicle) {
			setSelectedVehicle(initialVehicle)
		}
	}, [isOpen, initialWarehouseItem, initialVehicle])

	useEffect(() => {
		if (!isOpen) return
		if (selectedVehicle) return
		if (!initialVehicleId) return

		const fetchInitialVehicle = async () => {
			try {
				const res = await fetch(
					`${API_BASE_URL}/vehicles/${initialVehicleId}/page`,
					{
						headers: getAuthHeaders(),
					},
				)

				if (!res.ok) return

				const data = await res.json()
				if (data?.vehicle) {
					setSelectedVehicle(data.vehicle)
				}
			} catch (err) {
				console.error('Ошибка загрузки выбранного авто:', err)
			}
		}

		fetchInitialVehicle()
	}, [isOpen, initialVehicleId, selectedVehicle])

	useEffect(() => {
		if (!selectedWarehouseItem) {
			setQuantity(1)
			return
		}

		if (isSerializedItem(selectedWarehouseItem)) {
			setQuantity(1)
			return
		}

		if (Number(quantity || 0) > maxQuantity) {
			setQuantity(maxQuantity || 1)
		}
	}, [selectedWarehouseItem, maxQuantity])

	useEffect(() => {
		if (!isOpen) return
		if (equipmentLocked) return

		const search = equipmentSearch.trim()

		if (search.length > 0 && search.length < 2) {
			setEquipmentResults([])
			return
		}

		const timeout = setTimeout(async () => {
			setEquipmentSearchLoading(true)

			try {
				const params = new URLSearchParams()
				params.append('limit', '50')

				if (search) {
					params.append('search', search)
				}

				const res = await fetch(
					`${API_BASE_URL}/warehouse/available-equipment?${params.toString()}`,
					{
						headers: getAuthHeaders(),
					},
				)

				const data = await res.json().catch(() => null)

				if (!res.ok) {
					throw new Error(data?.detail || 'Не удалось найти оборудование')
				}

				setEquipmentResults(Array.isArray(data) ? data : [])
			} catch (err) {
				console.error(err)
				setEquipmentResults([])
			} finally {
				setEquipmentSearchLoading(false)
			}
		}, 300)

		return () => clearTimeout(timeout)
	}, [isOpen, equipmentSearch, equipmentLocked])

	useEffect(() => {
		if (!isOpen) return
		if (vehicleLocked) return

		const search = vehicleSearch.trim()

		if (search.length < 2) {
			setVehicleResults([])
			return
		}

		const timeout = setTimeout(async () => {
			setVehicleSearchLoading(true)

			try {
				const params = new URLSearchParams()
				params.append('q', search)
				params.append('limit', '20')

				const res = await fetch(
					`${API_BASE_URL}/vehicles/search?${params.toString()}`,
					{
						headers: getAuthHeaders(),
					},
				)

				const data = await res.json().catch(() => null)

				if (!res.ok) {
					throw new Error(data?.detail || 'Не удалось найти авто')
				}

				setVehicleResults(Array.isArray(data) ? data : [])
			} catch (err) {
				console.error(err)
				setVehicleResults([])
			} finally {
				setVehicleSearchLoading(false)
			}
		}, 300)

		return () => clearTimeout(timeout)
	}, [isOpen, vehicleSearch, vehicleLocked])

	const handleSelectWarehouseItem = item => {
		setSelectedWarehouseItem(item)
		setEquipmentSearch('')
		setEquipmentResults([])
		setQuantity(isSerializedItem(item) ? 1 : 1)
	}

	const handleSelectVehicle = vehicle => {
		setSelectedVehicle(vehicle)
		setVehicleSearch('')
		setVehicleResults([])
	}

	const handleClearVehicle = () => {
		if (vehicleLocked) return
		setSelectedVehicle(null)
	}

	const handleClearWarehouseItem = () => {
		if (equipmentLocked) return
		setSelectedWarehouseItem(null)
		setQuantity(1)
	}

	const handleQuantityChange = e => {
		const nextValue = Number(e.target.value || 1)

		if (nextValue < 1) {
			setQuantity(1)
			return
		}

		if (maxQuantity && nextValue > maxQuantity) {
			setQuantity(maxQuantity)
			return
		}

		setQuantity(nextValue)
	}

	const handleSubmit = async e => {
		e.preventDefault()

		if (!selectedVehicle?.id) {
			alert('Выберите автомобиль')
			return
		}

		if (!selectedWarehouseItem?.id && !initialWarehouseItemId) {
			alert('Выберите оборудование')
			return
		}

		const warehouseItemId = selectedWarehouseItem?.id || initialWarehouseItemId
		const finalQuantity = isSerializedItem(selectedWarehouseItem)
			? 1
			: Number(quantity || 0)

		if (finalQuantity <= 0) {
			alert('Количество должно быть больше 0')
			return
		}

		if (
			!isSerializedItem(selectedWarehouseItem) &&
			finalQuantity > maxQuantity
		) {
			alert(`Недостаточно количества. Доступно: ${maxQuantity}`)
			return
		}

		setSubmitLoading(true)

		try {
			const res = await fetch(
				`${API_BASE_URL}/warehouse/vehicles/${selectedVehicle.id}/equipment`,
				{
					method: 'POST',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({
						warehouse_item_id: Number(warehouseItemId),
						quantity: finalQuantity,
						note: note.trim() || null,
					}),
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(
					data?.detail || 'Не удалось привязать оборудование к авто',
				)
			}

			onAttached?.(data)
		} catch (err) {
			alert(err.message)
		} finally {
			setSubmitLoading(false)
		}
	}

	if (!isOpen) return null

	return (
		<div className='modal-overlay open' onClick={onClose}>
			<div
				className='modal-window attach-equipment-modal'
				onClick={e => e.stopPropagation()}
			>
				<div className='modal-header'>
					<span className='modal-title'>Привязать оборудование к авто</span>

					<button
						className='modal-close'
						type='button'
						onClick={onClose}
						disabled={submitLoading}
					>
						&times;
					</button>
				</div>

				<form onSubmit={handleSubmit}>
					<div className='attach-equipment-body'>
						<div className='attach-equipment-grid'>
							<div className='attach-equipment-section'>
								<div className='attach-equipment-section-title'>
									Оборудование
								</div>

								{selectedWarehouseItem ? (
									<div className='attach-selected-card'>
										<div className='attach-selected-title'>
											{getItemTitle(selectedWarehouseItem)}
										</div>

										<div className='attach-selected-meta'>
											{CATEGORIES[selectedWarehouseItem.category] ||
												selectedWarehouseItem.category ||
												'Категория не указана'}
										</div>

										<div className='attach-selected-meta'>
											{getItemIdentifierText(selectedWarehouseItem)}
										</div>

										<div className='attach-selected-meta'>
											Город:{' '}
											{selectedWarehouseItem.city_name ||
												selectedWarehouseItem.source_label ||
												'—'}
										</div>

										{!equipmentLocked && (
											<button
												type='button'
												className='attach-clear-btn'
												onClick={handleClearWarehouseItem}
											>
												Выбрать другое
											</button>
										)}
									</div>
								) : (
									<>
										<input
											className='warehouse-input'
											type='text'
											value={equipmentSearch}
											onChange={e => setEquipmentSearch(e.target.value)}
											placeholder='Поиск по названию, модели, IMEI, MAC...'
										/>

										<div className='attach-search-hint'>
											Можно оставить поле пустым — покажутся первые свободные
											объекты со склада.
										</div>

										<div className='attach-result-list'>
											{equipmentSearchLoading ? (
												<div className='attach-result-empty'>Поиск...</div>
											) : equipmentResults.length === 0 ? (
												<div className='attach-result-empty'>
													Свободное оборудование не найдено
												</div>
											) : (
												equipmentResults.map(item => (
													<button
														key={item.id}
														type='button'
														className='attach-result-item'
														onClick={() => handleSelectWarehouseItem(item)}
													>
														<div className='attach-result-title'>
															{getItemTitle(item)}
														</div>

														<div className='attach-result-meta'>
															{getItemIdentifierText(item)}
														</div>

														<div className='attach-result-meta'>
															{item.city_name ||
																item.source_label ||
																'Город не указан'}
														</div>
													</button>
												))
											)}
										</div>
									</>
								)}
							</div>

							<div className='attach-equipment-section'>
								<div className='attach-equipment-section-title'>Автомобиль</div>

								{selectedVehicle ? (
									<div className='attach-selected-card'>
										<div className='attach-selected-title'>
											{getVehicleTitle(selectedVehicle)}
										</div>

										<div className='attach-selected-meta'>
											Клиент: {getClientTitle(selectedVehicle)}
										</div>

										{selectedVehicle.client_phone && (
											<div className='attach-selected-meta'>
												Телефон: {selectedVehicle.client_phone}
											</div>
										)}

										{selectedVehicle.client_bin_iin && (
											<div className='attach-selected-meta'>
												БИН/ИИН: {selectedVehicle.client_bin_iin}
											</div>
										)}

										{!vehicleLocked && (
											<button
												type='button'
												className='attach-clear-btn'
												onClick={handleClearVehicle}
											>
												Выбрать другое
											</button>
										)}
									</div>
								) : (
									<>
										<input
											className='warehouse-input'
											type='text'
											value={vehicleSearch}
											onChange={e => setVehicleSearch(e.target.value)}
											placeholder='Поиск по VIN, ГРНЗ, клиенту, телефону...'
										/>

										<div className='attach-search-hint'>
											Введите минимум 2 символа.
										</div>

										<div className='attach-result-list'>
											{vehicleSearchLoading ? (
												<div className='attach-result-empty'>Поиск...</div>
											) : vehicleSearch.trim().length < 2 ? (
												<div className='attach-result-empty'>
													Начните вводить VIN, ГРНЗ или клиента
												</div>
											) : vehicleResults.length === 0 ? (
												<div className='attach-result-empty'>
													Автомобили не найдены
												</div>
											) : (
												vehicleResults.map(vehicle => (
													<button
														key={vehicle.id}
														type='button'
														className='attach-result-item'
														onClick={() => handleSelectVehicle(vehicle)}
													>
														<div className='attach-result-title'>
															{getVehicleTitle(vehicle)}
														</div>

														<div className='attach-result-meta'>
															Клиент: {getClientTitle(vehicle)}
														</div>

														<div className='attach-result-meta'>
															{vehicle.client_phone
																? `Телефон: ${vehicle.client_phone}`
																: ''}
															{vehicle.client_bin_iin
																? ` · БИН/ИИН: ${vehicle.client_bin_iin}`
																: ''}
														</div>
													</button>
												))
											)}
										</div>
									</>
								)}
							</div>
						</div>

						<div className='attach-equipment-bottom-grid'>
							<label className='warehouse-field'>
								<span className='warehouse-label required'>Количество</span>

								<input
									className={`warehouse-input ${
										isSerializedItem(selectedWarehouseItem)
											? 'warehouse-disabled-input'
											: ''
									}`}
									type='number'
									min='1'
									max={maxQuantity || 1}
									value={isSerializedItem(selectedWarehouseItem) ? 1 : quantity}
									disabled={isSerializedItem(selectedWarehouseItem)}
									onChange={handleQuantityChange}
								/>

								{selectedWarehouseItem &&
									!isSerializedItem(selectedWarehouseItem) && (
										<span className='attach-field-hint'>
											Доступно: {maxQuantity} шт.
										</span>
									)}
							</label>

							<label className='warehouse-field attach-note-field'>
								<span className='warehouse-label'>Комментарий</span>

								<input
									className='warehouse-input'
									type='text'
									value={note}
									onChange={e => setNote(e.target.value)}
									placeholder='Например: прямая привязка без заявки'
								/>
							</label>
						</div>

						<div className='attach-warning-box'>
							Оборудование будет привязано напрямую к автомобилю без заявки. В
							истории склада это будет отдельным движением.
						</div>
					</div>

					<div className='modal-footer warehouse-modal-footer'>
						<button
							className='modal-cancel-btn'
							type='button'
							onClick={onClose}
							disabled={submitLoading}
						>
							Отмена
						</button>

						<button
							className='warehouse-submit-btn'
							type='submit'
							disabled={
								submitLoading ||
								!selectedVehicle?.id ||
								!selectedWarehouseItem?.id
							}
						>
							{submitLoading ? 'Привязка...' : 'Привязать к авто'}
						</button>
					</div>
				</form>
			</div>
		</div>
	)
}
