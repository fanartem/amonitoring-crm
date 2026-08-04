import React, { useState, useEffect } from 'react'
import { API_BASE_URL, getJsonAuthHeaders } from '../api'
import '../styles/Requests.css'
import '../styles/Warehouse.css'

const CATEGORIES = {
	GPS_TRACKER: 'Трекер',
	BEACON: 'Маяк',
	FUEL_SENSOR: 'Датчик уровня топлива (ДУТ)',
	BLE_SENSOR: 'BLE-датчик',
	WIRED_SENSOR: 'Проводной датчик',
	RELAY: 'Реле',
	CABLE: 'Кабель',
	CONSUMABLE: 'Расходники',
	TOOLS: 'Инструменты',
	FIRST_AID: 'Аптечки',
	OTHER: 'Другое',
}

const IDENTIFIER_TYPES = ['IMEI', 'MAC', 'SERIAL', 'OTHER']

const STATUSES = {
	IN_STOCK: 'На складе',
	RESERVED: 'Резерв',
	INSTALLED: 'Установлено',
	WRITTEN_OFF: 'Списано',
}

const CONDITION_STATUSES = {
	NEW: 'Новое',
	USED: 'БУ',
}

export default function WarehouseItemModal({
	isOpen,
	onClose,
	onSaved,
	editItem,
	cities = [],
}) {
	const isEditMode = !!editItem

	const [formData, setFormData] = useState({
		category: 'GPS_TRACKER',
		name: '',
		manufacturer: '',
		model: '',
		identifier_type: 'IMEI',
		identifier_value: '',
		serial_number: '',
		is_serialized: true,
		quantity: 1,
		city_id: '',
		note: '',
		status: 'IN_STOCK',
		condition_status: 'NEW',
	})

	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')

	const isLinkedToRequest =
		isEditMode &&
		(editItem?.installed_source_type === 'REQUEST' ||
			(!editItem?.installed_source_type &&
				Boolean(editItem?.installed_request_id)))

	const isLinkedDirectly =
		isEditMode && editItem?.installed_source_type === 'DIRECT'

	useEffect(() => {
		if (!isOpen) return

		if (isEditMode) {
			const serialized = Boolean(editItem.is_serialized)

			setFormData({
				category: editItem.category || 'GPS_TRACKER',
				name: editItem.name || '',
				manufacturer: editItem.manufacturer || '',
				model: editItem.model || '',
				identifier_type: serialized
					? editItem.identifier_type || 'IMEI'
					: 'NONE',
				identifier_value: editItem.identifier_value || '',
				serial_number: editItem.serial_number || '',
				is_serialized: serialized,
				quantity: editItem.quantity || 1,
				city_id: editItem.city_id || '',
				note: editItem.note || '',
				status: editItem.status || 'IN_STOCK',
				condition_status: editItem.condition_status || 'NEW',
			})
		} else {
			setFormData({
				category: 'GPS_TRACKER',
				name: '',
				manufacturer: '',
				model: '',
				identifier_type: 'IMEI',
				identifier_value: '',
				serial_number: '',
				is_serialized: true,
				quantity: 1,
				city_id: cities[0]?.id || '',
				note: '',
				status: 'IN_STOCK',
				condition_status: 'NEW',
			})
		}

		setError('')
	}, [isOpen, editItem, isEditMode, cities])

	const handleChange = e => {
		const { name, value, type, checked } = e.target

		if (name === 'status' && isLinkedToRequest) {
			return
		}

		if (name === 'is_serialized') {
			if (checked) {
				setFormData(prev => ({
					...prev,
					is_serialized: true,
					quantity: 1,
					identifier_type: 'IMEI',
				}))
			} else {
				setFormData(prev => ({
					...prev,
					is_serialized: false,
					identifier_type: 'NONE',
					identifier_value: '',
				}))
			}
			return
		}

		setFormData(prev => ({
			...prev,
			[name]: type === 'checkbox' ? checked : value,
		}))
	}

	const handleSubmit = async e => {
		e.preventDefault()
		setError('')

		if (!formData.name.trim()) {
			setError('Наименование оборудования обязательно')
			return
		}

		if (!formData.city_id) {
			setError('Необходимо выбрать город склада')
			return
		}

		if (formData.is_serialized && !formData.identifier_value.trim()) {
			setError(
				'Для серийного оборудования нужно указать IMEI, MAC или серийный номер',
			)
			return
		}

		if (!formData.is_serialized && Number(formData.quantity) < 1) {
			setError('Количество должно быть больше 0')
			return
		}

		setLoading(true)

		try {
			const payload = {
				category: formData.category,
				name: formData.name.trim(),
				manufacturer: formData.manufacturer.trim() || null,
				model: formData.model.trim() || null,
				identifier_type: formData.is_serialized
					? formData.identifier_type
					: 'NONE',
				identifier_value: formData.is_serialized
					? formData.identifier_value.trim()
					: null,
				serial_number: formData.serial_number.trim() || null,
				is_serialized: formData.is_serialized,
				quantity: formData.is_serialized ? 1 : parseInt(formData.quantity, 10),
				...(!isEditMode || formData.is_serialized
					? { city_id: Number(formData.city_id) }
					: {}),
				condition_status: formData.condition_status || 'NEW',
				note: formData.note.trim() || null,
				...(isEditMode && !isLinkedToRequest && { status: formData.status }),
			}

			const url = isEditMode
				? `${API_BASE_URL}/warehouse/items/${editItem.id}`
				: `${API_BASE_URL}/warehouse/items`

			const method = isEditMode ? 'PATCH' : 'POST'

			const res = await fetch(url, {
				method,
				headers: getJsonAuthHeaders(),
				body: JSON.stringify(payload),
			})

			if (!res.ok) {
				const err = await res.json()
				throw new Error(err.detail || 'Ошибка сохранения')
			}

			onSaved()
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	if (!isOpen) return null

	return (
		<div className='modal-overlay open'>
			<div className='modal-window warehouse-modal-window'>
				<div className='modal-header'>
					<span className='modal-title'>
						{isEditMode ? 'Редактировать оборудование' : 'Добавить на склад'}
					</span>
					<button className='modal-close' onClick={onClose} type='button'>
						&times;
					</button>
				</div>

				{error && <div className='warehouse-error-banner'>{error}</div>}

				<div className='warehouse-modal-body'>
					<form id='warehouse-form' onSubmit={handleSubmit}>
						<div className='warehouse-form-card'>
							<div className='warehouse-form-section-title'>
								Основная информация
							</div>

							<div className='warehouse-form-grid'>
								<label className='warehouse-field'>
									<span className='warehouse-label required'>Категория</span>
									<select
										className='warehouse-input'
										name='category'
										value={formData.category}
										onChange={handleChange}
									>
										{Object.entries(CATEGORIES).map(([key, label]) => (
											<option key={key} value={key}>
												{label}
											</option>
										))}
									</select>
								</label>

								<label className='warehouse-field'>
									<span className='warehouse-label required'>Наименование</span>
									<input
										className='warehouse-input'
										type='text'
										name='name'
										value={formData.name}
										onChange={handleChange}
										placeholder='Например: Teltonika FMC920'
									/>
								</label>

								<label className='warehouse-field'>
									<span className='warehouse-label'>Производитель</span>
									<input
										className='warehouse-input'
										type='text'
										name='manufacturer'
										value={formData.manufacturer}
										onChange={handleChange}
										placeholder='Например: Teltonika'
									/>
								</label>

								<label className='warehouse-field'>
									<span className='warehouse-label'>Модель</span>
									<input
										className='warehouse-input'
										type='text'
										name='model'
										value={formData.model}
										onChange={handleChange}
										placeholder='Например: FMC920'
									/>
								</label>
							</div>
						</div>

						<div className='warehouse-form-card'>
							<div className='warehouse-form-section-title'>Складской учёт</div>

							<label className='warehouse-toggle-row'>
								<input
									type='checkbox'
									name='is_serialized'
									checked={formData.is_serialized}
									onChange={handleChange}
								/>

								<div>
									<div className='warehouse-toggle-title'>
										Серийное оборудование
									</div>
									<div className='warehouse-toggle-hint'>
										Включите, если у оборудования есть уникальный IMEI, MAC или
										серийный номер. Для расходников снимите галочку.
									</div>
								</div>
							</label>

							<div className='warehouse-form-grid warehouse-inner-grid'>
								<label className='warehouse-field'>
									<span className='warehouse-label required'>Город склада</span>

									<select
										className={`warehouse-input ${
											isEditMode && !formData.is_serialized
												? 'warehouse-disabled-input'
												: ''
										}`}
										name='city_id'
										value={formData.city_id}
										onChange={handleChange}
										disabled={isEditMode && !formData.is_serialized}
									>
										<option value=''>Выберите город</option>

										{cities.map(city => (
											<option key={city.id} value={city.id}>
												{city.name}
											</option>
										))}
									</select>

									{isEditMode && !formData.is_serialized && (
										<span className='warehouse-field-hint'>
											Для расходников город меняется через перенос количества
											между городами.
										</span>
									)}
								</label>
							</div>

							<div className='warehouse-form-grid warehouse-inner-grid'>
								<label className='warehouse-field'>
									<span className='warehouse-label required'>Состояние</span>

									<select
										className='warehouse-input'
										name='condition_status'
										value={formData.condition_status}
										onChange={handleChange}
									>
										{Object.entries(CONDITION_STATUSES).map(([key, label]) => (
											<option key={key} value={key}>
												{label}
											</option>
										))}
									</select>

									<span className='warehouse-field-hint'>
										Выберите БУ, если оборудование уже было в эксплуатации. При
										снятии оборудования через заявку состояние станет БУ
										автоматически.
									</span>
								</label>
							</div>

							{formData.is_serialized ? (
								<div className='warehouse-form-grid warehouse-inner-grid'>
									<label className='warehouse-field'>
										<span className='warehouse-label required'>Тип ID</span>
										<select
											className='warehouse-input'
											name='identifier_type'
											value={formData.identifier_type}
											onChange={handleChange}
										>
											{IDENTIFIER_TYPES.map(type => (
												<option key={type} value={type}>
													{type}
												</option>
											))}
										</select>
									</label>

									<label className='warehouse-field'>
										<span className='warehouse-label required'>
											Значение ID
										</span>
										<input
											className='warehouse-input'
											type='text'
											name='identifier_value'
											value={formData.identifier_value}
											onChange={handleChange}
											placeholder='IMEI / MAC / SERIAL'
										/>
									</label>

									<label className='warehouse-field'>
										<span className='warehouse-label'>Количество</span>
										<input
											className='warehouse-input warehouse-disabled-input'
											type='number'
											value='1'
											disabled
										/>
									</label>
								</div>
							) : (
								<div className='warehouse-form-grid warehouse-inner-grid'>
									<label className='warehouse-field'>
										<span className='warehouse-label required'>Количество</span>
										<input
											className='warehouse-input'
											type='number'
											name='quantity'
											value={formData.quantity}
											onChange={handleChange}
											min='1'
										/>
									</label>
								</div>
							)}

							{isEditMode && (
								<div className='warehouse-form-grid warehouse-inner-grid'>
									<label className='warehouse-field'>
										<span className='warehouse-label required'>Статус</span>

										<select
											className={`warehouse-input ${
												isLinkedToRequest ? 'warehouse-disabled-input' : ''
											}`}
											name='status'
											value={formData.status}
											onChange={handleChange}
											disabled={isLinkedToRequest}
										>
											{Object.entries(STATUSES).map(([key, label]) => (
												<option key={key} value={key}>
													{label}
												</option>
											))}
										</select>

										{isLinkedToRequest && (
											<span className='warehouse-field-hint'>
												Статус нельзя менять через склад, так как оборудование
												привязано к заявке #{editItem?.installed_request_id}.
												Сначала отвяжите оборудование внутри заявки.
											</span>
										)}

										{isLinkedDirectly && (
											<span className='warehouse-field-hint'>
												Если изменить статус установленного оборудования, прямая
												привязка к автомобилю будет автоматически закрыта.
											</span>
										)}
									</label>
								</div>
							)}
						</div>

						<div className='warehouse-form-card'>
							<div className='warehouse-form-section-title'>Примечание</div>

							<label className='warehouse-field'>
								<textarea
									className='warehouse-textarea'
									name='note'
									rows='3'
									value={formData.note}
									onChange={handleChange}
									placeholder='Дополнительная информация...'
								/>
							</label>
						</div>
					</form>
				</div>

				<div className='modal-footer warehouse-modal-footer'>
					<button className='modal-cancel-btn' type='button' onClick={onClose}>
						Отмена
					</button>

					<button
						className='warehouse-submit-btn'
						type='submit'
						form='warehouse-form'
						disabled={loading}
					>
						{loading
							? 'Сохранение...'
							: isEditMode
								? 'Сохранить изменения'
								: 'Добавить на склад'}
					</button>
				</div>
			</div>
		</div>
	)
}
