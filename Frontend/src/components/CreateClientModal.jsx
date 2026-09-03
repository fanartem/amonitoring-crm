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

// Списки совпадают с бэкендом:
// CLIENTS_STATUS_MANAGE_PERMISSION_CODES и CLIENTS_REASSIGN_PERMISSION_CODES
// в permissions.py, CLIENT_PAYMENT_TYPE_MANAGE_PERMISSION_CODES
// и CLIENT_MONITORING_PASSWORD_MANAGE_PERMISSION_CODES в clients.py.
const canManageClientStatus = user =>
	hasAnyPermission(user, ['clients.status.change', 'clients.manage'])

const canManageResponsibleManager = user =>
	hasAnyPermission(user, ['clients.responsible.reassign', 'clients.manage'])

const canManageClientPaymentType = user =>
	hasAnyPermission(user, [
		'clients.payment_type.manage',
		'clients.payment.manage',
		'clients.manage',
	])

const canManageClientMonitoringPassword = user =>
	hasAnyPermission(user, [
		'clients.monitoring_credentials.manage',
		'clients.manage',
	])

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

const EMPTY_FORM = {
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
}

export default function CreateClientModal({
	isOpen,
	onClose,
	onCreated,
	editClient,
}) {
	const isEditMode = !!editClient

	const [formData, setFormData] = useState(EMPTY_FORM)

	const [error, setError] = useState('')
	const [loading, setLoading] = useState(false)
	const [clientsList, setClientsList] = useState([])

	// Клиент не может стать родителем сам себе или своему предку:
	// сюда попадают его id и id всех его подклиентов.
	const [forbiddenParentIds, setForbiddenParentIds] = useState([])

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

	const fetchForbiddenParentIds = async clientId => {
		try {
			const res = await fetch(
				`${API_BASE_URL}/clients/${clientId}/subclients`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				// Нет прав или эндпоинта — кольцо всё равно поймает бэкенд.
				setForbiddenParentIds([Number(clientId)])
				return
			}

			const data = await res.json()

			setForbiddenParentIds([
				Number(clientId),
				...(Array.isArray(data) ? data.map(item => Number(item.id)) : []),
			])
		} catch (err) {
			console.error('Ошибка загрузки подклиентов:', err)
			setForbiddenParentIds([Number(clientId)])
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
			// Родитель теперь определяется настоящей ссылкой parent_client_id,
			// а не совпадением строкового имени из выгрузки.
			const parentClientId = editClient.parent_client_id || ''

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

				is_subclient: Boolean(parentClientId),
				parent_client_id: parentClientId,
				parent_source_name: editClient.source_parent_client_name || '',
			})

			fetchForbiddenParentIds(editClient.id)
		} else {
			setFormData(EMPTY_FORM)
			setForbiddenParentIds([])
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

		const parentName =
			client.parent_client_company_name ||
			client.parent_client_name ||
			client.source_parent_client_name

		const parent = parentName ? ` / родитель: ${parentName}` : ''

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
			client.parent_client_name,
			client.parent_client_company_name,
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

	// Себя и своих подклиентов родителем выбрать нельзя — иначе кольцо.
	const parentClientOptions = clientsList.filter(
		client => !forbiddenParentIds.includes(Number(client.id)),
	)

	const selectedParentClient = clientsList.find(
		client => String(client.id) === String(formData.parent_client_id),
	)

	const handleParentClientSelect = parentClient => {
		setFormData(prev => ({
			...prev,
			parent_client_id: parentClient ? parentClient.id : '',
			parent_source_name: parentClient ? getClientSourceName(parentClient) : '',
		}))
	}

	const resetForm = () => {
		setFormData(EMPTY_FORM)
		setForbiddenParentIds([])
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

		if (formData.is_subclient && !formData.parent_client_id) {
			setError('Выберите родительского клиента')
			return
		}

		setLoading(true)

		try {
			const sourceClientName =
				formData.type === 'INDIVIDUAL'
					? formData.name.trim()
					: formData.company_name.trim()

			const parentClientId =
				formData.is_subclient && formData.parent_client_id
					? Number(formData.parent_client_id)
					: null

			// Имя родителя берём из выбранной опции, а если список ещё
			// не догрузился — из того, что пришло с клиентом.
			const parentSourceName = parentClientId
				? getClientSourceName(selectedParentClient) ||
					formData.parent_source_name
				: null

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
				// Пустое поле не должно затирать существующий пароль:
				// в списке клиентов monitoring_password не приходит вовсе.
				monitoring_password:
					canSetMonitoringPassword && formData.monitoring_password.trim()
						? formData.monitoring_password.trim()
						: undefined,

				// При редактировании эти три поля меняются отдельными эндпоинтами —
				// PATCH /clients/{id} их игнорирует.
				status: !isEditMode && canSetClientStatus ? formData.status : undefined,
				payment_type: isEditMode
					? undefined
					: canSetPaymentType
						? formData.payment_type
						: 'PREPAYMENT',
				responsible_manager_id:
					!isEditMode &&
					canSetResponsibleManager &&
					formData.responsible_manager_id
						? Number(formData.responsible_manager_id)
						: undefined,

				// Настоящая связь с родителем. null снимает её.
				parent_client_id: parentClientId,

				// Поля выгрузки ГЛОНАСС Софт трогаем только при создании.
				// Раньше редактирование импортированного клиента затирало
				// source_system и source_client_name значениями из формы.
				source_system: isEditMode
					? undefined
					: formData.is_subclient
						? 'CRM'
						: null,
				source_client_name: isEditMode ? undefined : sourceClientName,
				source_parent_client_name: parentSourceName,
				source_inn: isEditMode ? undefined : null,
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

			if (
				isEditMode &&
				canSetClientStatus &&
				formData.status !== (editClient.status || 'ACTIVE')
			) {
				const statusRes = await fetch(
					`${API_BASE_URL}/clients/${editClient.id}/status`,
					{
						method: 'PATCH',
						headers: getJsonAuthHeaders(),
						body: JSON.stringify({
							status: formData.status,
						}),
					},
				)

				if (!statusRes.ok) {
					throw new Error(await getErrorMessage(statusRes))
				}
			}

			if (
				isEditMode &&
				canSetResponsibleManager &&
				String(formData.responsible_manager_id || '') !==
					String(editClient.responsible_manager_id || '')
			) {
				const responsibleRes = await fetch(
					`${API_BASE_URL}/clients/${editClient.id}/responsible`,
					{
						method: 'PATCH',
						headers: getJsonAuthHeaders(),
						body: JSON.stringify({
							responsible_manager_id: formData.responsible_manager_id
								? Number(formData.responsible_manager_id)
								: null,
							apply_to_subclients: false,
						}),
					},
				)

				if (!responsibleRes.ok) {
					throw new Error(await getErrorMessage(responsibleRes))
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
												parent_client_id: checked ? prev.parent_client_id : '',
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
											options={parentClientOptions}
											placeholder='Напишите или выберите родительского клиента'
											onChange={handleParentClientSelect}
											getOptionValue={client => client.id}
											getOptionLabel={getClientLabel}
											getOptionSearchText={getClientSearchText}
											emptyText='Родительский клиент не найден'
										/>

										<div className='create-client-note'>
											Подклиент наследует параметры установки родителя, если у
											него нет своих. Блокировка родителя закрывает создание
											заявок и добавление машин всей ветке.
										</div>
									</label>
								)}
							</div>
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

								{isEditMode && canSetClientStatus && (
									<div className='create-client-note'>
										Разблокировать подклиента, пока заблокирован его родитель,
										нельзя — блокировка наследуется сверху.
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
