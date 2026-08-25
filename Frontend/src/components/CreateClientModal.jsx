import React, { useState, useEffect, useRef } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import { getStoredUser, hasAnyPermission } from '../utils/access'
import '../styles/Requests.css'
import '../styles/CreateClientModal.css'

const CLIENT_TYPES = {
	TOO: 'ТОО',
	IP: 'ИП',
	INDIVIDUAL: 'Физ. лицо',
}

const CLIENT_PAYMENT_TYPES = {
	PREPAYMENT: 'Предоплата',
	POSTPAYMENT: 'Постоплата',
}

const getErrorMessage = async res => {
	const contentType = res.headers.get('content-type') || ''

	if (contentType.includes('application/json')) {
		const data = await res.json().catch(() => null)

		if (typeof data?.detail === 'string') {
			return data.detail
		}

		if (Array.isArray(data?.detail)) {
			return data.detail.map(item => item.msg).join(', ')
		}
	}

	const text = await res.text().catch(() => '')

	return text || 'Ошибка сохранения клиента'
}

const hasLegacyRole = (user, roles) => roles.includes(user?.role)

const canManageClientStatus = user =>
	hasAnyPermission(user, [
		'clients.status.manage',
		'clients.status.edit',
		'clients.update_status',
		'clients.edit_status',
		'clients.manage',
	]) || hasLegacyRole(user, ['ADMIN', 'ROP', 'ACCOUNTANT'])

const canManageResponsibleManager = user =>
	hasAnyPermission(user, [
		'clients.responsible_manager.manage',
		'clients.responsible.manage',
		'clients.assign_responsible',
		'clients.edit_responsible',
		'clients.manage',
	]) || hasLegacyRole(user, ['ADMIN', 'ROP'])

const canManageClientPaymentType = user =>
	hasAnyPermission(user, [
		'clients.payment_type.manage',
		'clients.payment.manage',
		'clients.edit_payment',
		'clients.manage',
	]) || hasLegacyRole(user, ['ADMIN', 'ROP'])

const canManageClientMonitoringPassword = user =>
	hasAnyPermission(user, [
		'clients.monitoring_credentials.manage',
		'clients.credentials.manage',
		'clients.monitoring_password.manage',
		'clients.edit_monitoring_credentials',
		'clients.manage',
	]) || hasLegacyRole(user, ['ADMIN', 'ROP', 'TECH_SUPPORT'])

function SearchableSelect({
	value,
	options,
	placeholder = 'Напишите или выберите',
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
		<div className='searchable-select' ref={wrapperRef}>
			<div
				className={`searchable-select-control ${error ? 'request-field-error' : ''} ${
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
					}}
				/>

				{value && !disabled ? (
					<button
						type='button'
						className='searchable-select-clear'
						onClick={handleClear}
					>
						×
					</button>
				) : (
					<span className='searchable-select-arrow'>▾</span>
				)}
			</div>

			{isOpen && !disabled && (
				<div className='searchable-select-dropdown'>
					{filteredOptions.length === 0 ? (
						<div className='searchable-select-empty'>{emptyText}</div>
					) : (
						filteredOptions.slice(0, 80).map(option => (
							<div
								key={getOptionValue(option)}
								className={`searchable-select-option ${
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
						<div className='searchable-select-more'>
							Показаны первые 80 совпадений. Уточните поиск.
						</div>
					)}
				</div>
			)}
		</div>
	)
}

export default function CreateClientModal({
	isOpen,
	onClose,
	onCreated,
	editClient,
}) {
	const isEditMode = !!editClient

	const [formData, setFormData] = useState({
		type: 'TOO',
		name: '',
		company_name: '',
		bin_iin: '',
		phone: '',
		email: '',
		monitoring_login: '',
		monitoring_password: '',

		status: 'ACTIVE',
		payment_type: 'PREPAYMENT',
		responsible_manager_id: '',

		is_subclient: false,
		parent_client_id: '',
		parent_source_name: '',
	})

	const [error, setError] = useState('')
	const [loading, setLoading] = useState(false)
	const [clientsList, setClientsList] = useState([])

	const [responsibleManagers, setResponsibleManagers] = useState([])

	const user = getStoredUser()

	const canSetClientStatus = canManageClientStatus(user)
	const canSetResponsibleManager = canManageResponsibleManager(user)
	const canSetPaymentType = canManageClientPaymentType(user)
	const canSetMonitoringPassword = canManageClientMonitoringPassword(user)

	const fetchClients = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/clients`, {
				headers: getAuthHeaders(),
			})

			if (res.ok) {
				const data = await res.json()
				setClientsList(
					Array.isArray(data) ? data.filter(c => !c.is_deleted) : [],
				)
			}
		} catch (err) {
			console.error('Ошибка загрузки клиентов:', err)
		}
	}

	const fetchResponsibleManagers = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/users/responsible-managers`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить ответственных')
			}

			const data = await res.json()
			setResponsibleManagers(Array.isArray(data) ? data : [])
		} catch (err) {
			console.error('Ошибка загрузки ответственных менеджеров:', err)
		}
	}

	useEffect(() => {
		if (!isOpen) return

		fetchClients()

		if (canSetResponsibleManager) {
			fetchResponsibleManagers()
		}

		if (isEditMode) {
			setFormData({
				type: editClient.type || 'TOO',
				name: editClient.name || '',
				company_name: editClient.company_name || '',
				bin_iin: editClient.bin_iin || '',
				phone: editClient.phone || '',
				email: editClient.email || '',
				monitoring_login: editClient.monitoring_login || '',
				monitoring_password: canSetMonitoringPassword
					? editClient.monitoring_password || ''
					: '',

				status: editClient.status || 'ACTIVE',
				payment_type: editClient.payment_type || 'PREPAYMENT',
				responsible_manager_id: editClient.responsible_manager_id || '',

				is_subclient: Boolean(editClient.source_parent_client_name),
				parent_client_id: '',
				parent_source_name: editClient.source_parent_client_name || '',
			})
		} else {
			setFormData({
				type: 'TOO',
				name: '',
				bin_iin: '',
				company_name: '',
				phone: '',
				email: '',
				monitoring_login: '',
				monitoring_password: '',

				status: 'ACTIVE',
				payment_type: 'PREPAYMENT',
				responsible_manager_id: '',

				is_subclient: false,
				parent_client_id: '',
				parent_source_name: '',
			})
		}

		setError('')
	}, [
		isOpen,
		editClient,
		isEditMode,
		canSetResponsibleManager,
		canSetMonitoringPassword,
	])

	if (!isOpen) return null

	const handleChange = e => {
		const { name, value } = e.target

		setFormData(prev => ({
			...prev,
			[name]: value,
		}))
	}

	const isIndividualClient = formData.type === 'INDIVIDUAL'

	const getIdentifierLabel = () => {
		return isIndividualClient ? 'ИИН' : 'БИН'
	}

	const getClientLabel = client => {
		if (!client) return ''

		const mainName =
			client.company_name || client.name || `Клиент #${client.id}`
		const representative =
			client.company_name && client.name ? ` — ${client.name}` : ''
		const parent = client.source_parent_client_name
			? ` / родитель: ${client.source_parent_client_name}`
			: ''

		return `${mainName}${representative}${parent}`
	}

	const getClientSearchText = client => {
		return [
			client.company_name,
			client.name,
			client.bin_iin,
			client.phone,
			client.email,
			client.monitoring_login,
			client.source_client_name,
			client.source_parent_client_name,
			client.source_inn,
		]
			.filter(Boolean)
			.join(' ')
	}

	const getClientSourceName = client => {
		if (!client) return ''

		return (
			client.source_client_name ||
			client.company_name ||
			client.name ||
			`Клиент #${client.id}`
		)
	}

	const getClientStatusLabel = status => {
		if (status === 'ACTIVE') return 'Активный'
		if (status === 'DEBTOR') return 'Должник'
		if (status === 'BLOCKED') return 'Заблокирован'

		return status || 'Активный'
	}

	const getResponsibleRoleLabel = role => {
		if (role === 'MANAGER') return 'Менеджер'
		if (role === 'ROP') return 'РОП'
		if (role === 'ADMIN') return 'Админ'

		return role || ''
	}

	const handleParentClientSelect = parentClient => {
		setFormData(prev => ({
			...prev,
			parent_client_id: parentClient ? parentClient.id : '',
			parent_source_name: parentClient ? getClientSourceName(parentClient) : '',
		}))
	}

	const resetForm = () => {
		setFormData({
			type: 'TOO',
			name: '',
			company_name: '',
			bin_iin: '',
			phone: '',
			email: '',
			monitoring_login: '',
			monitoring_password: '',

			status: 'ACTIVE',
			payment_type: 'PREPAYMENT',
			responsible_manager_id: '',

			is_subclient: false,
			parent_client_id: '',
			parent_source_name: '',
		})
		setError('')
	}

	const handleClose = () => {
		resetForm()
		onClose()
	}

	const handleSubmit = async e => {
		e.preventDefault()
		setError('')

		if (!formData.name.trim()) {
			setError('ФИО представителя обязательно')
			return
		}

		if (!isIndividualClient && !formData.bin_iin.trim()) {
			setError('Для ТОО и ИП поле БИН обязательно')
			return
		}

		if (
			(formData.type === 'TOO' || formData.type === 'IP') &&
			!formData.company_name.trim()
		) {
			setError('Название компании обязательно')
			return
		}

		if (!formData.phone.trim()) {
			setError('Телефон обязателен')
			return
		}

		if (formData.is_subclient && !formData.parent_source_name) {
			setError('Выберите родительского клиента')
			return
		}

		setLoading(true)

		try {
			const sourceClientName =
				formData.type === 'INDIVIDUAL'
					? formData.name.trim()
					: formData.company_name.trim()

			const payload = {
				type: formData.type,
				name: formData.name.trim(),
				bin_iin: formData.bin_iin.trim() || null,
				company_name:
					formData.type === 'INDIVIDUAL'
						? null
						: formData.company_name.trim() || null,
				phone: formData.phone.trim(),
				email: formData.email.trim() || null,
				monitoring_login: formData.monitoring_login.trim() || null,
				monitoring_password: canSetMonitoringPassword
					? formData.monitoring_password.trim() || null
					: undefined,

				status: canSetClientStatus ? formData.status : undefined,
				payment_type: canSetPaymentType ? formData.payment_type : 'PREPAYMENT',
				responsible_manager_id:
					canSetResponsibleManager && formData.responsible_manager_id
						? Number(formData.responsible_manager_id)
						: undefined,

				source_system: formData.is_subclient ? 'CRM' : null,
				source_client_name: sourceClientName,
				source_parent_client_name: formData.is_subclient
					? formData.parent_source_name
					: null,
				source_inn: null,
			}

			const url = isEditMode
				? `${API_BASE_URL}/clients/${editClient.id}`
				: `${API_BASE_URL}/clients`

			const method = isEditMode ? 'PATCH' : 'POST'

			const res = await fetch(url, {
				method,
				headers: getJsonAuthHeaders(),
				body: JSON.stringify(payload),
			})

			if (!res.ok) {
				throw new Error(await getErrorMessage(res))
			}

			if (
				isEditMode &&
				canSetPaymentType &&
				formData.payment_type !== (editClient.payment_type || 'PREPAYMENT')
			) {
				const paymentRes = await fetch(
					`${API_BASE_URL}/clients/${editClient.id}/payment-type`,
					{
						method: 'PATCH',
						headers: getJsonAuthHeaders(),
						body: JSON.stringify({
							payment_type: formData.payment_type,
						}),
					},
				)

				if (!paymentRes.ok) {
					throw new Error(await getErrorMessage(paymentRes))
				}
			}

			resetForm()
			onCreated()
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className='modal-overlay open'>
			<div className='modal-window create-client-modal'>
				<div className='modal-header'>
					<span className='modal-title'>
						{isEditMode ? 'Редактировать клиента' : 'Добавить клиента'}
					</span>
					<button className='modal-close' onClick={handleClose} type='button'>
						&times;
					</button>
				</div>

				{error && <div className='create-client-error-banner'>{error}</div>}

				<div className='create-client-body'>
					<form id='create-client-form' onSubmit={handleSubmit}>
						<div className='create-client-card'>
							<div className='create-client-section-title'>
								Основная информация
							</div>

							<div className='create-client-grid'>
								<label className='create-client-field'>
									<span className='create-client-label required'>
										Тип клиента
									</span>
									<select
										name='type'
										value={formData.type}
										onChange={handleChange}
										className='create-client-input'
									>
										{Object.entries(CLIENT_TYPES).map(([key, label]) => (
											<option key={key} value={key}>
												{label}
											</option>
										))}
									</select>
								</label>

								<label className='create-client-field'>
									<span className='create-client-label required'>
										ФИО представителя
									</span>
									<input
										type='text'
										name='name'
										value={formData.name}
										onChange={handleChange}
										className='create-client-input'
										placeholder='Например: Иван Иванов'
									/>
								</label>

								{(formData.type === 'TOO' || formData.type === 'IP') && (
									<label className='create-client-field create-client-full'>
										<span className='create-client-label required'>
											Название компании
										</span>
										<input
											type='text'
											name='company_name'
											value={formData.company_name}
											onChange={handleChange}
											className='create-client-input'
											placeholder='Например: TOO Autopark Monitoring'
										/>
									</label>
								)}

								<label className='create-client-field'>
									<span
										className={`create-client-label ${!isIndividualClient ? 'required' : ''}`}
									>
										{getIdentifierLabel()}
									</span>

									<input
										type='text'
										name='bin_iin'
										value={formData.bin_iin}
										onChange={handleChange}
										className='create-client-input'
										placeholder={
											isIndividualClient
												? 'Введите ИИН, если есть'
												: 'Введите БИН'
										}
									/>
								</label>
							</div>

							{!isEditMode && (
								<div className='create-client-subclient-block'>
									<label
										className={`create-client-subclient-pill ${
											formData.is_subclient ? 'active' : ''
										}`}
									>
										<input
											type='checkbox'
											checked={formData.is_subclient}
											onChange={e => {
												const checked = e.target.checked

												setFormData(prev => ({
													...prev,
													is_subclient: checked,
													parent_client_id: checked
														? prev.parent_client_id
														: '',
													parent_source_name: checked
														? prev.parent_source_name
														: '',
												}))
											}}
										/>

										<span className='create-client-subclient-checkmark'>
											{formData.is_subclient ? '✓' : ''}
										</span>

										<span>Клиент является подклиентом</span>
									</label>

									{formData.is_subclient && (
										<label className='create-client-field create-client-full create-client-parent-field'>
											<span className='create-client-label required'>
												Родительский клиент
											</span>

											<SearchableSelect
												value={formData.parent_client_id}
												options={clientsList}
												placeholder='Напишите или выберите родительского клиента'
												onChange={handleParentClientSelect}
												getOptionValue={client => client.id}
												getOptionLabel={getClientLabel}
												getOptionSearchText={getClientSearchText}
												emptyText='Родительский клиент не найден'
											/>
										</label>
									)}
								</div>
							)}
						</div>

						<div className='create-client-card'>
							<div className='create-client-section-title'>Контакты</div>

							<div className='create-client-grid'>
								<label className='create-client-field'>
									<span className='create-client-label required'>Телефон</span>
									<input
										type='text'
										name='phone'
										value={formData.phone}
										onChange={handleChange}
										className='create-client-input'
										placeholder='+7 777 123 45 67'
									/>
								</label>

								<label className='create-client-field'>
									<span className='create-client-label'>Email</span>
									<input
										type='email'
										name='email'
										value={formData.email}
										onChange={handleChange}
										className='create-client-input'
										placeholder='client@example.com'
									/>
								</label>

								<label className='create-client-field'>
									<span className='create-client-label'>
										Логин платформы мониторинга
									</span>
									<input
										type='text'
										name='monitoring_login'
										value={formData.monitoring_login}
										onChange={handleChange}
										className='create-client-input'
										placeholder='Логин клиента в платформе'
									/>
								</label>

								{canSetMonitoringPassword && (
									<label className='create-client-field'>
										<span className='create-client-label'>
											Пароль платформы мониторинга
										</span>
										<input
											type='text'
											name='monitoring_password'
											value={formData.monitoring_password}
											onChange={handleChange}
											className='create-client-input'
											placeholder='Пароль клиента в платформе'
											autoComplete='off'
										/>
									</label>
								)}
							</div>
						</div>
						{(canSetClientStatus || canSetResponsibleManager) && (
							<div className='create-client-card'>
								<div className='create-client-section-title'>
									Статус и ответственный
								</div>

								<div className='create-client-grid'>
									{canSetClientStatus && (
										<label className='create-client-field'>
											<span className='create-client-label'>
												Статус клиента
											</span>

											<select
												name='status'
												value={formData.status}
												onChange={handleChange}
												className='create-client-input'
											>
												<option value='ACTIVE'>
													{getClientStatusLabel('ACTIVE')}
												</option>
												<option value='DEBTOR'>
													{getClientStatusLabel('DEBTOR')}
												</option>
												<option value='BLOCKED'>
													{getClientStatusLabel('BLOCKED')}
												</option>
											</select>
										</label>
									)}

									{canSetResponsibleManager && (
										<label className='create-client-field'>
											<span className='create-client-label'>
												Ответственный менеджер
											</span>

											<select
												name='responsible_manager_id'
												value={formData.responsible_manager_id}
												onChange={handleChange}
												className='create-client-input'
											>
												<option value=''>Не назначен</option>

												{responsibleManagers.map(user => (
													<option key={user.id} value={user.id}>
														{user.name} · {getResponsibleRoleLabel(user.role)}
													</option>
												))}
											</select>
										</label>
									)}
								</div>

								{formData.is_subclient && canSetResponsibleManager && (
									<div className='create-client-note'>
										Если выбран родительский клиент, ответственный обычно должен
										совпадать с ответственным родителя.
									</div>
								)}
							</div>
						)}

						{canSetPaymentType && (
							<div className='create-client-card'>
								<div className='create-client-section-title'>Тип оплаты</div>
								<label className='create-client-field'>
									<select
										name='payment_type'
										value={formData.payment_type}
										onChange={handleChange}
										className='create-client-input'
									>
										{Object.entries(CLIENT_PAYMENT_TYPES).map(
											([key, label]) => (
												<option key={key} value={key}>
													{label}
												</option>
											),
										)}
									</select>
								</label>
								<div className='create-client-note'>
									Постоплата делает заявки клиента видимыми монтажникам сразу
									после создания.
								</div>
							</div>
						)}
					</form>
				</div>

				<div className='modal-footer create-client-footer'>
					<button
						className='create-client-cancel-btn'
						type='button'
						onClick={handleClose}
					>
						Отмена
					</button>

					<button
						className='create-client-submit-btn'
						type='submit'
						form='create-client-form'
						disabled={loading}
					>
						{loading
							? 'Сохранение...'
							: isEditMode
								? 'Сохранить изменения'
								: 'Сохранить клиента'}
					</button>
				</div>
			</div>
		</div>
	)
}
