import React, { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import '../styles/Requests.css'

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

const getUserRole = () => {
	return String(getTokenPayload()?.role || '').toUpperCase()
}

const getCurrentUserId = () => {
	const payload = getTokenPayload()
	return Number(payload.id || payload.sub || null)
}

const SUPPORT_VISIBLE_ROLES = [
	'ADMIN',
	'ROP',
	'MANAGER',
	'TECH_SUPPORT',
	'ACCOUNTANT',
	'WAREHOUSE_MANAGER',
]

const SUPPORT_EDIT_ROLES = ['ADMIN', 'ROP', 'TECH_SUPPORT']
const SUPPORT_DELETE_ROLES = ['ADMIN', 'ROP']

const statusLabels = {
	NEW: 'Новая',
	IN_PROGRESS: 'В работе',
	COMPLETED: 'Завершена',
	CANCELLED: 'Отменена',
}

const statusClasses = {
	NEW: 'status-new',
	IN_PROGRESS: 'status-progress',
	COMPLETED: 'status-done',
	CANCELLED: 'status-cancelled',
}

const priorityLabels = {
	LOW: 'Низкий',
	NORMAL: 'Обычный',
	HIGH: 'Высокий',
	URGENT: 'Срочный',
}

const priorityClasses = {
	LOW: 'support-priority-low',
	NORMAL: 'support-priority-normal',
	HIGH: 'support-priority-high',
	URGENT: 'support-priority-urgent',
}

const roleLabels = {
	ADMIN: 'Админ',
	ROP: 'РОП',
	MANAGER: 'Менеджер',
	TECH_SUPPORT: 'Тех. поддержка',
	ACCOUNTANT: 'Бухгалтер',
	WAREHOUSE_MANAGER: 'Зав. складом',
}

const formatDate = value => {
	if (!value) return '—'

	const date = new Date(value)

	if (Number.isNaN(date.getTime())) return '—'

	return (
		date.toLocaleDateString('ru-RU') +
		' ' +
		date.toLocaleTimeString('ru-RU', {
			hour: '2-digit',
			minute: '2-digit',
		})
	)
}

const getClientName = item => {
	return item.company_name || item.client_name || `Клиент #${item.client_id}`
}

const getVehicleName = item => {
	const title = `${item.vehicle_brand || ''} ${item.vehicle_model || ''}`.trim()
	const plate = item.vehicle_plate_number || 'б/н'
	const vin = item.vehicle_vin || 'VIN не указан'

	if (!item.vehicle_id) return 'Авто не выбрано'

	return `${title || 'Автомобиль'} (${plate}) · ${vin}`
}

const getClientLabel = client => {
	if (!client) return ''

	const mainName = client.company_name || client.name || `Клиент #${client.id}`
	const representative =
		client.company_name && client.name ? ` — ${client.name}` : ''
	const parent = client.source_parent_client_name
		? ` / родитель: ${client.source_parent_client_name}`
		: ''
	const phone = client.phone ? ` / ${client.phone}` : ''

	return `${mainName}${representative}${parent}${phone}`
}

const getClientSearchText = client => {
	return [
		client.company_name,
		client.name,
		client.bin_iin,
		client.phone,
		client.email,
		client.source_client_name,
		client.source_parent_client_name,
		client.source_inn,
	]
		.filter(Boolean)
		.join(' ')
}

const getVehicleLabel = vehicle => {
	const title = `${vehicle.brand || ''} ${vehicle.model || ''}`.trim()
	const plate = vehicle.plate_number || 'б/н'
	const vin = vehicle.vin || 'VIN не указан'

	return `${title || 'Автомобиль'} (${plate}) · ${vin}`
}

const getVehicleSearchText = vehicle => {
	return [
		vehicle.brand,
		vehicle.model,
		vehicle.plate_number,
		vehicle.vin,
		vehicle.year,
		vehicle.type,
	]
		.filter(Boolean)
		.join(' ')
}

function SearchableSelect({
	value,
	options,
	placeholder,
	onChange,
	getOptionValue,
	getOptionLabel,
	getOptionSearchText,
	disabled = false,
	error = false,
	emptyText = 'Ничего не найдено',
}) {
	const [query, setQuery] = useState('')
	const [isOpen, setIsOpen] = useState(false)
	const wrapperRef = useRef(null)

	useEffect(() => {
		const handleClickOutside = event => {
			if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
				setIsOpen(false)
				setQuery('')
			}
		}

		document.addEventListener('mousedown', handleClickOutside)

		return () => {
			document.removeEventListener('mousedown', handleClickOutside)
		}
	}, [])

	const selectedOption = options.find(
		option => String(getOptionValue(option)) === String(value),
	)

	const inputValue = isOpen
		? query
		: selectedOption
			? getOptionLabel(selectedOption)
			: ''

	const normalizedQuery = query.trim().toLowerCase()

	const filteredOptions = normalizedQuery
		? options.filter(option =>
				getOptionSearchText(option).toLowerCase().includes(normalizedQuery),
			)
		: options

	const handleSelect = option => {
		onChange(option)
		setQuery('')
		setIsOpen(false)
	}

	const handleClear = e => {
		e.stopPropagation()
		onChange(null)
		setQuery('')
		setIsOpen(false)
	}

	return (
		<div className='support-searchable-select' ref={wrapperRef}>
			<div
				className={`support-searchable-control ${error ? 'support-field-error' : ''} ${
					disabled ? 'disabled' : ''
				}`}
				onClick={() => {
					if (!disabled) setIsOpen(true)
				}}
			>
				<input
					type='text'
					value={inputValue}
					disabled={disabled}
					placeholder={placeholder}
					onFocus={() => {
						if (!disabled) {
							setIsOpen(true)
							setQuery('')
						}
					}}
					onChange={e => {
						setQuery(e.target.value)
						setIsOpen(true)
					}}
					onKeyDown={e => {
						if (e.key === 'Escape') {
							setIsOpen(false)
							setQuery('')
						}

						if (e.key === 'Enter') {
							e.preventDefault()
							e.stopPropagation()

							if (isOpen && filteredOptions.length > 0) {
								handleSelect(filteredOptions[0])
							}
						}
					}}
				/>

				{value && !disabled ? (
					<button
						type='button'
						className='support-searchable-clear'
						onClick={handleClear}
					>
						×
					</button>
				) : (
					<span className='support-searchable-arrow'>▾</span>
				)}
			</div>

			{isOpen && !disabled && (
				<div className='support-searchable-dropdown'>
					{filteredOptions.length === 0 ? (
						<div className='support-searchable-empty'>{emptyText}</div>
					) : (
						filteredOptions.slice(0, 80).map(option => (
							<div
								key={getOptionValue(option)}
								className={`support-searchable-option ${
									String(getOptionValue(option)) === String(value)
										? 'selected'
										: ''
								}`}
								onMouseDown={e => {
									e.preventDefault()
									handleSelect(option)
								}}
							>
								{getOptionLabel(option)}
							</div>
						))
					)}

					{filteredOptions.length > 80 && (
						<div className='support-searchable-more'>
							Показаны первые 80 совпадений. Уточните поиск.
						</div>
					)}
				</div>
			)}
		</div>
	)
}

function SupportRequestCreateModal({
	isOpen,
	onClose,
	onCreated,
	clients,
	assignees,
}) {
	const [clientVehicles, setClientVehicles] = useState([])
	const [formData, setFormData] = useState({
		client_id: '',
		contact_phone: '',
		problem_description: '',
		priority: 'NORMAL',
		assigned_to: '',
		use_vehicle: false,
		vehicle_id: '',
	})
	const [missingFields, setMissingFields] = useState([])
	const [error, setError] = useState('')
	const [loading, setLoading] = useState(false)

	useEffect(() => {
		if (!isOpen) return

		setFormData({
			client_id: '',
			contact_phone: '',
			problem_description: '',
			priority: 'NORMAL',
			assigned_to: '',
			use_vehicle: false,
			vehicle_id: '',
		})
		setClientVehicles([])
		setMissingFields([])
		setError('')
	}, [isOpen])

	if (!isOpen) return null

	const fetchClientVehicles = async clientId => {
		if (!clientId) {
			setClientVehicles([])
			return
		}

		try {
			const res = await fetch(
				`${API_BASE_URL}/vehicles?client_id=${clientId}`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (res.ok) {
				const data = await res.json()
				setClientVehicles(Array.isArray(data) ? data : [])
			}
		} catch (err) {
			console.error('Ошибка загрузки авто клиента:', err)
		}
	}

	const clearMissing = fieldName => {
		setMissingFields(prev => prev.filter(item => item !== fieldName))
	}

	const handleClientSelect = client => {
		if (client) {
			setFormData(prev => ({
				...prev,
				client_id: client.id,
				contact_phone: prev.contact_phone || client.phone || '',
				vehicle_id: '',
				use_vehicle: false,
			}))

			fetchClientVehicles(client.id)
			clearMissing('client_id')
			return
		}

		setFormData(prev => ({
			...prev,
			client_id: '',
			vehicle_id: '',
			use_vehicle: false,
		}))
		setClientVehicles([])
	}

	const validate = () => {
		const required = []

		if (!formData.client_id) required.push('client_id')
		if (!formData.contact_phone.trim()) required.push('contact_phone')
		if (!formData.problem_description.trim()) {
			required.push('problem_description')
		}
		if (formData.use_vehicle && !formData.vehicle_id) {
			required.push('vehicle_id')
		}

		if (required.length > 0) {
			setMissingFields(required)
			setError('Пожалуйста, заполните обязательные поля.')
			return false
		}

		return true
	}

	const getErrorMessage = async response => {
		try {
			const data = await response.json()

			if (typeof data.detail === 'string') return data.detail

			if (Array.isArray(data.detail)) {
				return data.detail
					.map(item => item.msg || item.detail || JSON.stringify(item))
					.join('\n')
			}

			return JSON.stringify(data)
		} catch {
			return await response.text()
		}
	}

	const handleSubmit = async e => {
		e.preventDefault()
		setError('')

		if (!validate()) return

		setLoading(true)

		try {
			const payload = {
				client_id: Number(formData.client_id),
				vehicle_id:
					formData.use_vehicle && formData.vehicle_id
						? Number(formData.vehicle_id)
						: null,
				contact_phone: formData.contact_phone.trim(),
				problem_description: formData.problem_description.trim(),
				priority: formData.priority,
				assigned_to: formData.assigned_to ? Number(formData.assigned_to) : null,
			}

			const res = await fetch(`${API_BASE_URL}/support-requests`, {
				method: 'POST',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify(payload),
			})

			if (!res.ok) {
				throw new Error(await getErrorMessage(res))
			}

			onCreated()
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className='modal-overlay open' onClick={onClose}>
			<div
				className='custom-detail-window support-modal-window'
				onClick={e => e.stopPropagation()}
			>
				<div className='modal-header'>
					<span className='modal-title'>Создание заявки техподдержки</span>

					<button className='modal-close' onClick={onClose} type='button'>
						&times;
					</button>
				</div>

				{error && <div className='request-modal-error-banner'>{error}</div>}

				<form
					className='support-form'
					onSubmit={handleSubmit}
					onKeyDown={e => {
						if (
							e.key === 'Enter' &&
							e.target.tagName !== 'SELECT' &&
							e.target.tagName !== 'TEXTAREA'
						) {
							e.preventDefault()
						}
					}}
				>
					<div className='info-card'>
						<div className='info-card-title'>Клиент</div>

						<label className='support-field support-field-full'>
							<span className='support-label required'>Выберите клиента</span>

							<SearchableSelect
								value={formData.client_id}
								options={clients}
								placeholder='Напишите или выберите существующего клиента'
								onChange={handleClientSelect}
								getOptionValue={client => client.id}
								getOptionLabel={getClientLabel}
								getOptionSearchText={getClientSearchText}
								error={missingFields.includes('client_id')}
								emptyText='Клиент не найден'
							/>
						</label>

						<label className='support-checkbox-row'>
							<input
								type='checkbox'
								checked={formData.use_vehicle}
								disabled={!formData.client_id}
								onChange={e => {
									const checked = e.target.checked

									setFormData(prev => ({
										...prev,
										use_vehicle: checked,
										vehicle_id: checked ? prev.vehicle_id : '',
									}))

									if (!checked) clearMissing('vehicle_id')
								}}
							/>
							<span>Выбрать определённое авто</span>
						</label>

						{formData.use_vehicle && (
							<label className='support-field support-field-full'>
								<span className='support-label required'>
									Автомобиль клиента
								</span>

								<SearchableSelect
									value={formData.vehicle_id}
									options={clientVehicles}
									placeholder='Напишите или выберите авто клиента'
									onChange={vehicle => {
										setFormData(prev => ({
											...prev,
											vehicle_id: vehicle ? vehicle.id : '',
										}))
										clearMissing('vehicle_id')
									}}
									getOptionValue={vehicle => vehicle.id}
									getOptionLabel={getVehicleLabel}
									getOptionSearchText={getVehicleSearchText}
									error={missingFields.includes('vehicle_id')}
									emptyText='Авто клиента не найдено'
									disabled={!formData.client_id}
								/>
							</label>
						)}
					</div>

					<div className='info-card'>
						<div className='info-card-title'>Проблема</div>

						<div className='support-form-grid'>
							<label className='support-field'>
								<span className='support-label required'>Номер для связи</span>

								<input
									className={`support-input ${
										missingFields.includes('contact_phone')
											? 'support-field-error'
											: ''
									}`}
									type='tel'
									value={formData.contact_phone}
									onChange={e => {
										setFormData(prev => ({
											...prev,
											contact_phone: e.target.value,
										}))
										clearMissing('contact_phone')
									}}
									placeholder='+7...'
								/>
							</label>

							<label className='support-field'>
								<span className='support-label'>Приоритет</span>

								<select
									className='support-input'
									value={formData.priority}
									onChange={e =>
										setFormData(prev => ({
											...prev,
											priority: e.target.value,
										}))
									}
								>
									<option value='LOW'>Низкий</option>
									<option value='NORMAL'>Обычный</option>
									<option value='HIGH'>Высокий</option>
									<option value='URGENT'>Срочный</option>
								</select>
							</label>

							<label className='support-field support-field-full'>
								<span className='support-label'>Исполнитель</span>

								<select
									className='support-input'
									value={formData.assigned_to}
									onChange={e =>
										setFormData(prev => ({
											...prev,
											assigned_to: e.target.value,
										}))
									}
								>
									<option value=''>Не назначен</option>

									{assignees.map(user => (
										<option key={user.id} value={user.id}>
											{user.name} · {roleLabels[user.role] || user.role}
										</option>
									))}
								</select>
							</label>

							<label className='support-field support-field-full'>
								<span className='support-label required'>
									Описание проблемы
								</span>

								<textarea
									className={`support-textarea ${
										missingFields.includes('problem_description')
											? 'support-field-error'
											: ''
									}`}
									rows={6}
									value={formData.problem_description}
									onChange={e => {
										setFormData(prev => ({
											...prev,
											problem_description: e.target.value,
										}))
										clearMissing('problem_description')
									}}
									placeholder='Опишите, что произошло, что не работает, с кем связаться...'
								/>
							</label>
						</div>
					</div>

					<div className='custom-footer'>
						<button type='button' className='btn-reset' onClick={onClose}>
							Отмена
						</button>

						<button type='submit' className='btn-green' disabled={loading}>
							{loading ? 'Создание...' : 'Создать заявку'}
						</button>
					</div>
				</form>
			</div>
		</div>
	)
}

function SupportRequestDetailModal({
	isOpen,
	onClose,
	supportRequestId,
	onUpdated,
	assignees,
}) {
	const [activeTab, setActiveTab] = useState('info')
	const [item, setItem] = useState(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')
	const [newComment, setNewComment] = useState('')
	const [commentLoading, setCommentLoading] = useState(false)
	const [isEditing, setIsEditing] = useState(false)
	const [editData, setEditData] = useState({
		contact_phone: '',
		problem_description: '',
		priority: 'NORMAL',
	})

	const userRole = getUserRole()
	const currentUserId = getCurrentUserId()

	const canEdit = SUPPORT_EDIT_ROLES.includes(userRole)
	const canDelete = SUPPORT_DELETE_ROLES.includes(userRole)
	const canChangeStatus =
		SUPPORT_EDIT_ROLES.includes(userRole) ||
		Number(item?.assigned_to) === Number(currentUserId)

	useEffect(() => {
		if (!isOpen || !supportRequestId) return

		setActiveTab('info')
		setIsEditing(false)
		fetchDetail()
	}, [isOpen, supportRequestId])

	if (!isOpen) return null

	const getErrorMessage = async response => {
		try {
			const data = await response.json()

			if (typeof data.detail === 'string') return data.detail

			if (Array.isArray(data.detail)) {
				return data.detail
					.map(row => row.msg || row.detail || JSON.stringify(row))
					.join('\n')
			}

			return JSON.stringify(data)
		} catch {
			return await response.text()
		}
	}

	const fetchDetail = async () => {
		setLoading(true)
		setError('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/support-requests/${supportRequestId}`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				throw new Error(await getErrorMessage(res))
			}

			const data = await res.json()
			setItem(data)
			setEditData({
				contact_phone: data.contact_phone || '',
				problem_description: data.problem_description || '',
				priority: data.priority || 'NORMAL',
			})
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	const patchSupportRequest = async payload => {
		const res = await fetch(
			`${API_BASE_URL}/support-requests/${supportRequestId}`,
			{
				method: 'PATCH',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify(payload),
			},
		)

		if (!res.ok) {
			throw new Error(await getErrorMessage(res))
		}

		await fetchDetail()
		onUpdated()
	}

	const handleStatusChange = async e => {
		const status = e.target.value

		try {
			await patchSupportRequest({ status })
		} catch (err) {
			alert(err.message)
		}
	}

	const handleAssignedChange = async e => {
		const assignedTo = e.target.value ? Number(e.target.value) : null

		try {
			await patchSupportRequest({ assigned_to: assignedTo })
		} catch (err) {
			alert(err.message)
		}
	}

	const handleSaveEdit = async () => {
		if (!editData.contact_phone.trim()) {
			alert('Номер для связи не может быть пустым')
			return
		}

		if (!editData.problem_description.trim()) {
			alert('Описание проблемы не может быть пустым')
			return
		}

		try {
			await patchSupportRequest({
				contact_phone: editData.contact_phone.trim(),
				problem_description: editData.problem_description.trim(),
				priority: editData.priority,
			})
			setIsEditing(false)
		} catch (err) {
			alert(err.message)
		}
	}

	const handleAddComment = async () => {
		if (!newComment.trim()) return

		setCommentLoading(true)

		try {
			const res = await fetch(
				`${API_BASE_URL}/support-requests/${supportRequestId}/comments`,
				{
					method: 'POST',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({
						message: newComment.trim(),
					}),
				},
			)

			if (!res.ok) {
				throw new Error(await getErrorMessage(res))
			}

			setNewComment('')
			await fetchDetail()
			onUpdated()
		} catch (err) {
			alert(err.message)
		} finally {
			setCommentLoading(false)
		}
	}

	const handleDelete = async () => {
		if (!window.confirm('Удалить заявку техподдержки?')) return

		try {
			const res = await fetch(
				`${API_BASE_URL}/support-requests/${supportRequestId}`,
				{
					method: 'DELETE',
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				throw new Error(await getErrorMessage(res))
			}

			onUpdated()
			onClose()
		} catch (err) {
			alert(err.message)
		}
	}

	const renderHistoryMessage = historyItem => {
		const action = historyItem.action

		if (action === 'CREATED') return 'Заявка техподдержки создана'
		if (action === 'ASSIGNED') return 'Исполнитель назначен'
		if (action === 'ASSIGNED_CHANGED') return 'Исполнитель изменён'
		if (action === 'STATUS_CHANGED') {
			return `Статус изменён: ${
				statusLabels[historyItem.old_value] || historyItem.old_value || '—'
			} → ${
				statusLabels[historyItem.new_value] || historyItem.new_value || '—'
			}`
		}
		if (action === 'COMMENT_ADDED') return 'Добавлен комментарий'
		if (action === 'CONTACT_PHONE_CHANGED') return 'Изменён номер для связи'
		if (action === 'PROBLEM_DESCRIPTION_CHANGED') {
			return 'Изменено описание проблемы'
		}
		if (action === 'PRIORITY_CHANGED') return 'Изменён приоритет'
		if (action === 'CLIENT_CHANGED') return 'Изменён клиент'
		if (action === 'VEHICLE_CHANGED') return 'Изменён автомобиль'
		if (action === 'DELETED') return 'Заявка удалена'

		return action
	}

	return (
		<div className='modal-overlay open' onClick={onClose}>
			<div
				className='custom-detail-window support-modal-window'
				onClick={e => e.stopPropagation()}
			>
				<div className='modal-header'>
					<span className='modal-title'>
						Тех. поддержка №{supportRequestId}
					</span>

					<button className='modal-close' onClick={onClose} type='button'>
						&times;
					</button>
				</div>

				<div className='custom-tabs'>
					<button
						className={`custom-tab ${activeTab === 'info' ? 'active' : ''}`}
						onClick={() => setActiveTab('info')}
					>
						Информация
					</button>

					<button
						className={`custom-tab ${activeTab === 'comments' ? 'active' : ''}`}
						onClick={() => setActiveTab('comments')}
					>
						Комментарии{' '}
						<span className='tab-badge'>{item?.comments?.length || 0}</span>
					</button>

					<button
						className={`custom-tab ${activeTab === 'history' ? 'active' : ''}`}
						onClick={() => setActiveTab('history')}
					>
						История
					</button>
				</div>

				<div className='custom-body'>
					{loading ? (
						<div className='loading-state'>Загрузка данных...</div>
					) : error ? (
						<div className='validation-banner visible'>{error}</div>
					) : item ? (
						<>
							{activeTab === 'info' && (
								<div className='tab-content'>
									<div className='support-detail-actions'>
										{canEdit && !isEditing && (
											<button
												type='button'
												className='btn-edit-request'
												onClick={() => setIsEditing(true)}
											>
												✎ Изменить
											</button>
										)}

										{canDelete && (
											<button
												type='button'
												className='support-danger-btn'
												onClick={handleDelete}
											>
												Удалить
											</button>
										)}
									</div>

									<div className='info-card'>
										<div className='info-card-title'>Клиент</div>

										<div className='info-row'>
											<span className='info-key'>Клиент</span>
											<span className='info-val'>{getClientName(item)}</span>
										</div>

										<div className='info-row'>
											<span className='info-key'>Статус клиента</span>
											<span className='info-val'>
												{item.client_status || '—'}
											</span>
										</div>

										<div className='info-row'>
											<span className='info-key'>Телефон клиента</span>
											<span className='info-val'>
												{item.client_phone || '—'}
											</span>
										</div>

										<div className='info-row'>
											<span className='info-key'>Автомобиль</span>
											<span className='info-val'>{getVehicleName(item)}</span>
										</div>
									</div>

									<div className='info-card'>
										<div className='info-card-title'>Проблема</div>

										{isEditing ? (
											<div className='support-form-grid'>
												<label className='support-field'>
													<span className='support-label'>Номер для связи</span>

													<input
														className='support-input'
														type='tel'
														value={editData.contact_phone}
														onChange={e =>
															setEditData(prev => ({
																...prev,
																contact_phone: e.target.value,
															}))
														}
													/>
												</label>

												<label className='support-field'>
													<span className='support-label'>Приоритет</span>

													<select
														className='support-input'
														value={editData.priority}
														onChange={e =>
															setEditData(prev => ({
																...prev,
																priority: e.target.value,
															}))
														}
													>
														<option value='LOW'>Низкий</option>
														<option value='NORMAL'>Обычный</option>
														<option value='HIGH'>Высокий</option>
														<option value='URGENT'>Срочный</option>
													</select>
												</label>

												<label className='support-field support-field-full'>
													<span className='support-label'>
														Описание проблемы
													</span>

													<textarea
														className='support-textarea'
														rows={6}
														value={editData.problem_description}
														onChange={e =>
															setEditData(prev => ({
																...prev,
																problem_description: e.target.value,
															}))
														}
													/>
												</label>

												<div className='support-edit-buttons'>
													<button
														type='button'
														className='btn-reset'
														onClick={() => {
															setIsEditing(false)
															setEditData({
																contact_phone: item.contact_phone || '',
																problem_description:
																	item.problem_description || '',
																priority: item.priority || 'NORMAL',
															})
														}}
													>
														Отмена
													</button>

													<button
														type='button'
														className='btn-green'
														onClick={handleSaveEdit}
													>
														Сохранить
													</button>
												</div>
											</div>
										) : (
											<>
												<div className='info-row'>
													<span className='info-key'>Номер для связи</span>
													<span className='info-val'>
														{item.contact_phone || '—'}
													</span>
												</div>

												<div className='info-row'>
													<span className='info-key'>Приоритет</span>
													<span
														className={`support-priority-badge ${
															priorityClasses[item.priority] ||
															priorityClasses.NORMAL
														}`}
													>
														{priorityLabels[item.priority] || item.priority}
													</span>
												</div>

												<div className='support-description-box'>
													{item.problem_description}
												</div>
											</>
										)}
									</div>

									<div className='info-card'>
										<div className='info-card-title'>Работа</div>

										<div className='info-row'>
											<span className='info-key'>Статус</span>
											<span
												className={`status-badge ${
													statusClasses[item.status] || 'status-new'
												}`}
											>
												{statusLabels[item.status] || item.status}
											</span>
										</div>

										<div className='info-row'>
											<span className='info-key'>Исполнитель</span>
											<span className='info-val'>
												{item.assigned_to_name || 'Не назначен'}
											</span>
										</div>

										<div className='info-row'>
											<span className='info-key'>Создал</span>
											<span className='info-val'>
												{item.created_by_name || '—'}
											</span>
										</div>

										<div className='info-row'>
											<span className='info-key'>Дата создания</span>
											<span className='info-val'>
												{formatDate(item.created_at)}
											</span>
										</div>

										{item.completed_at && (
											<div className='info-row'>
												<span className='info-key'>Завершена</span>
												<span className='info-val'>
													{formatDate(item.completed_at)}
												</span>
											</div>
										)}
									</div>
								</div>
							)}

							{activeTab === 'comments' && (
								<div className='tab-content flex-col'>
									<div className='comments-area'>
										{!item.comments || item.comments.length === 0 ? (
											<div className='empty-state'>Комментариев пока нет</div>
										) : (
											item.comments.map(comment => (
												<div key={comment.id} className='comment-bubble'>
													<div>
														<strong>{comment.user_name || 'Сотрудник'}</strong>
														<span className='comment-date'>
															{formatDate(comment.created_at)}
														</span>
													</div>
													<div>{comment.message}</div>
												</div>
											))
										)}
									</div>

									<div className='comment-input-area'>
										<textarea
											value={newComment}
											onChange={e => setNewComment(e.target.value)}
											placeholder='Напишите комментарий...'
										/>

										<button
											type='button'
											className='btn-green'
											onClick={handleAddComment}
											disabled={commentLoading}
										>
											{commentLoading ? 'Отправка...' : 'Отправить'}
										</button>
									</div>
								</div>
							)}

							{activeTab === 'history' && (
								<div className='tab-content'>
									{!item.history || item.history.length === 0 ? (
										<div className='empty-state'>История пуста</div>
									) : (
										item.history.map(historyItem => (
											<div key={historyItem.id} className='history-item'>
												<div className='history-dot'></div>

												<div className='history-content'>
													<div className='history-action'>
														{renderHistoryMessage(historyItem)}
													</div>

													<div className='history-meta'>
														{formatDate(historyItem.created_at)}
														<span className='history-author'>
															{historyItem.user_name || 'Система'}
														</span>
													</div>
												</div>
											</div>
										))
									)}
								</div>
							)}
						</>
					) : null}
				</div>

				{item && (
					<div className='custom-footer support-footer'>
						<div className='footer-group'>
							<span>Статус:</span>

							<select
								className='footer-select'
								value={item.status}
								onChange={handleStatusChange}
								disabled={!canChangeStatus}
							>
								<option value='NEW'>Новая</option>
								<option value='IN_PROGRESS'>В работе</option>
								<option value='COMPLETED'>Завершена</option>
								<option value='CANCELLED'>Отменена</option>
							</select>
						</div>

						{canEdit && (
							<div className='footer-group'>
								<span>Исполнитель:</span>

								<select
									className='footer-select'
									value={item.assigned_to || ''}
									onChange={handleAssignedChange}
								>
									<option value=''>Не назначен</option>

									{assignees.map(user => (
										<option key={user.id} value={user.id}>
											{user.name} · {roleLabels[user.role] || user.role}
										</option>
									))}
								</select>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	)
}

export default function SupportRequests() {
	const [items, setItems] = useState([])
	const [clients, setClients] = useState([])
	const [assignees, setAssignees] = useState([])
	const [filteredItems, setFilteredItems] = useState([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')

	const [isCreateModalOpen, setCreateModalOpen] = useState(false)
	const [selectedSupportRequestId, setSelectedSupportRequestId] = useState(null)
	const [activeDropdown, setActiveDropdown] = useState(null)

	const [filters, setFilters] = useState({
		search: '',
		status: '',
		priority: '',
		assigned_to: '',
		only_my: false,
	})

	const userRole = getUserRole()
	const currentUserId = getCurrentUserId()

	const canView = SUPPORT_VISIBLE_ROLES.includes(userRole)
	const canCreate = canView
	const canDelete = SUPPORT_DELETE_ROLES.includes(userRole)

	useEffect(() => {
		if (!canView) return

		fetchSupportRequests()
		fetchClients()
		fetchAssignees()
	}, [canView])

	useEffect(() => {
		if (!canView) return

		const intervalId = setInterval(() => {
			if (document.hidden) return
			if (isCreateModalOpen) return

			fetchSupportRequests({ silent: true })
		}, 15000)

		return () => clearInterval(intervalId)
	}, [canView, isCreateModalOpen])

	useEffect(() => {
		let result = items

		const query = filters.search.trim().toLowerCase()

		if (query) {
			result = result.filter(item => {
				const values = [
					item.id,
					item.contact_phone,
					item.problem_description,
					item.client_name,
					item.company_name,
					item.vehicle_brand,
					item.vehicle_model,
					item.vehicle_plate_number,
					item.vehicle_vin,
					item.assigned_to_name,
					item.created_by_name,
				]

				return values.filter(Boolean).join(' ').toLowerCase().includes(query)
			})
		}

		if (filters.status) {
			result = result.filter(item => item.status === filters.status)
		}

		if (filters.priority) {
			result = result.filter(item => item.priority === filters.priority)
		}

		if (filters.assigned_to) {
			const assigneeQuery = filters.assigned_to.trim().toLowerCase()

			result = result.filter(item =>
				String(item.assigned_to_name || '')
					.toLowerCase()
					.includes(assigneeQuery),
			)
		}

		if (filters.only_my) {
			result = result.filter(
				item => Number(item.assigned_to) === Number(currentUserId),
			)
		}

		const statusOrder = {
			NEW: 1,
			IN_PROGRESS: 2,
			COMPLETED: 3,
			CANCELLED: 4,
		}

		result = [...result].sort((a, b) => {
			const groupA = statusOrder[a.status] || 99
			const groupB = statusOrder[b.status] || 99

			if (groupA !== groupB) return groupA - groupB

			return (
				new Date(b.created_at || 0).getTime() -
				new Date(a.created_at || 0).getTime()
			)
		})

		setFilteredItems(result)
	}, [items, filters, currentUserId])

	useEffect(() => {
		const handleClickOutside = () => setActiveDropdown(null)

		document.addEventListener('click', handleClickOutside)

		return () => document.removeEventListener('click', handleClickOutside)
	}, [])

	const fetchSupportRequests = async ({ silent = false } = {}) => {
		if (!silent) {
			setLoading(true)
			setError('')
		}

		try {
			const res = await fetch(`${API_BASE_URL}/support-requests`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить заявки')
			}

			const data = await res.json()
			setItems(Array.isArray(data) ? data : [])
		} catch (err) {
			setError(err.message)
		} finally {
			if (!silent) setLoading(false)
		}
	}

	const fetchClients = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/clients`, {
				headers: getAuthHeaders(),
			})

			if (res.ok) {
				const data = await res.json()
				setClients(Array.isArray(data) ? data : [])
			}
		} catch (err) {
			console.error('Ошибка загрузки клиентов:', err)
		}
	}

	const fetchAssignees = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/support-requests/assignees`, {
				headers: getAuthHeaders(),
			})

			if (res.ok) {
				const data = await res.json()
				setAssignees(Array.isArray(data) ? data : [])
			}
		} catch (err) {
			console.error('Ошибка загрузки исполнителей:', err)
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
			status: '',
			priority: '',
			assigned_to: '',
			only_my: false,
		})
	}

	const toggleDropdown = (e, itemId) => {
		e.stopPropagation()
		setActiveDropdown(prev => (prev === itemId ? null : itemId))
	}

	const handleDelete = async (e, itemId) => {
		e.stopPropagation()
		setActiveDropdown(null)

		if (!window.confirm('Удалить заявку техподдержки?')) return

		try {
			const res = await fetch(`${API_BASE_URL}/support-requests/${itemId}`, {
				method: 'DELETE',
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось удалить заявку')
			}

			fetchSupportRequests()
		} catch (err) {
			alert(err.message)
		}
	}

	if (!canView) {
		return (
			<div className='requests-page-container'>
				<div className='validation-banner visible'>
					Раздел техподдержки недоступен для монтажников.
				</div>
			</div>
		)
	}

	return (
		<div className='requests-page-container support-requests-page'>
			<div className='requests-toolbar-sticky'>
				<div className='filters-bar filters-bar-top filters-bar-always-visible'>
					<div className='filter-group filter-main'>
						<label>Глобальный поиск</label>
						<input
							className={
								filters.search ? 'filter-input filter-active' : 'filter-input'
							}
							type='text'
							name='search'
							placeholder='Клиент, телефон, описание, госномер, VIN...'
							value={filters.search}
							onChange={handleFilterChange}
						/>
					</div>

					<div className='filter-group filter-creator'>
						<label>Исполнитель</label>
						<input
							className={
								filters.assigned_to
									? 'filter-input filter-active'
									: 'filter-input'
							}
							type='text'
							name='assigned_to'
							placeholder='ФИО исполнителя...'
							value={filters.assigned_to}
							onChange={handleFilterChange}
						/>
					</div>
				</div>

				<div className='filters-panel'>
					<div className='filters-bar'>
						<div className='filter-group'>
							<label>Статус</label>
							<select
								className={
									filters.status
										? 'filter-select filter-active'
										: 'filter-select'
								}
								name='status'
								value={filters.status}
								onChange={handleFilterChange}
							>
								<option value=''>Все статусы</option>
								<option value='NEW'>Новые</option>
								<option value='IN_PROGRESS'>В работе</option>
								<option value='COMPLETED'>Завершённые</option>
								<option value='CANCELLED'>Отменённые</option>
							</select>
						</div>

						<div className='filter-group'>
							<label>Приоритет</label>
							<select
								className={
									filters.priority
										? 'filter-select filter-active'
										: 'filter-select'
								}
								name='priority'
								value={filters.priority}
								onChange={handleFilterChange}
							>
								<option value=''>Все приоритеты</option>
								<option value='LOW'>Низкий</option>
								<option value='NORMAL'>Обычный</option>
								<option value='HIGH'>Высокий</option>
								<option value='URGENT'>Срочный</option>
							</select>
						</div>

						<label
							className={`my-requests-toggle ${filters.only_my ? 'active' : ''}`}
						>
							<input
								type='checkbox'
								name='only_my'
								checked={filters.only_my}
								onChange={handleFilterChange}
							/>
							<span>Мои заявки</span>
						</label>

						<button className='btn-reset' onClick={resetFilters}>
							Сбросить
						</button>

						<button
							className='btn-reset'
							onClick={() => fetchSupportRequests()}
							disabled={loading}
						>
							{loading ? 'Загрузка...' : 'Обновить'}
						</button>
					</div>
				</div>
			</div>

			{error && <div className='validation-banner visible'>{error}</div>}

			<div className='requests-count'>
				Кол-во заявок техподдержки: <strong>{filteredItems.length}</strong>
			</div>

			<div className='requests-list'>
				{filteredItems.length === 0 ? (
					<div className='empty-state'>
						{loading ? 'Загрузка заявок...' : 'Заявки техподдержки не найдены'}
					</div>
				) : (
					filteredItems.map(item => (
						<div
							key={item.id}
							className='request-card support-request-card'
							style={{
								zIndex: activeDropdown === item.id ? 100 : 1,
								position: 'relative',
								cursor: 'default',
							}}
						>
							<div className='card-column'>
								<div className='card-item card-item-client'>
									<span className='card-label'>Клиент</span>
									<span className='card-value'>{getClientName(item)}</span>

									<span className='support-card-subtitle'>
										№{item.id} · {item.contact_phone || 'номер не указан'}
									</span>

									<span
										className={`support-priority-badge ${
											priorityClasses[item.priority] || priorityClasses.NORMAL
										}`}
									>
										{priorityLabels[item.priority] || item.priority}
									</span>
								</div>

								<div className='card-item card-item-status'>
									<span className='card-label'>Статус</span>
									<div
										className={`status-badge ${
											statusClasses[item.status] || 'status-new'
										}`}
									>
										{statusLabels[item.status] || item.status}
									</div>
								</div>
							</div>

							<div className='card-column'>
								<div className='card-item card-item-vehicles'>
									<span className='card-label'>Авто</span>
									<span className='card-value'>{getVehicleName(item)}</span>
								</div>

								<div className='card-item'>
									<span className='card-label'>Исполнитель</span>
									<span className='card-value'>
										{item.assigned_to_name || 'Не назначен'}
									</span>
								</div>
							</div>

							<div className='card-column support-problem-column'>
								<div className='card-item'>
									<span className='card-label'>Описание проблемы</span>
									<span className='card-value support-problem-preview'>
										{item.problem_description || '—'}
									</span>
								</div>
							</div>

							<div className='card-column'>
								<div className='card-item'>
									<span className='card-label'>Создано</span>
									<span className='card-value'>
										{formatDate(item.created_at)}
									</span>
								</div>

								<div className='card-item'>
									<span className='card-label'>Создатель</span>
									<span className='card-value'>
										{item.created_by_name || '—'}
									</span>
								</div>
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
										setSelectedSupportRequestId(item.id)
									}}
								>
									Детали
								</button>

								<div
									className='card-actions'
									onClick={e => toggleDropdown(e, item.id)}
								>
									&#8942;
								</div>

								{activeDropdown === item.id && (
									<div
										className='dropdown-menu'
										style={{ top: '35px', right: '0' }}
									>
										<div
											className='dropdown-item'
											onClick={e => {
												e.stopPropagation()
												setActiveDropdown(null)
												setSelectedSupportRequestId(item.id)
											}}
										>
											<svg viewBox='0 0 24 24'>
												<path d='M4 4h16v16H4V4zm2 2v12h12V6H6zm2 2h8v2H8V8zm0 4h8v2H8v-2z' />
											</svg>
											Открыть
										</div>

										{canDelete && (
											<>
												<div className='dropdown-divider'></div>

												<div
													className='dropdown-item'
													style={{ color: '#c62828' }}
													onClick={e => handleDelete(e, item.id)}
												>
													<svg viewBox='0 0 24 24' fill='#c62828'>
														<path d='M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z' />
													</svg>
													Удалить
												</div>
											</>
										)}
									</div>
								)}
							</div>
						</div>
					))
				)}
			</div>

			{canCreate && (
				<div className='create-btn-container'>
					<button
						className='btn-create-floating'
						onClick={() => setCreateModalOpen(true)}
					>
						Создать заявку
					</button>
				</div>
			)}

			<SupportRequestCreateModal
				isOpen={isCreateModalOpen}
				onClose={() => setCreateModalOpen(false)}
				onCreated={() => {
					setCreateModalOpen(false)
					fetchSupportRequests()
				}}
				clients={clients}
				assignees={assignees}
			/>

			<SupportRequestDetailModal
				isOpen={Boolean(selectedSupportRequestId)}
				supportRequestId={selectedSupportRequestId}
				onClose={() => setSelectedSupportRequestId(null)}
				onUpdated={() => fetchSupportRequests()}
				assignees={assignees}
			/>
		</div>
	)
}
