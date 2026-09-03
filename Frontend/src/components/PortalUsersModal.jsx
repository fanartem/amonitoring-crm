import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'

// Вкладки сайдбара. Порядок тот же, что в интерфейсе.
const TAB_USERS = 'users'
const TAB_CREATE = 'create'
const TAB_PERMISSIONS = 'permissions'

const EMPTY_CREATE_FORM = {
	email: '',
	name: '',
	password: '',
}

const PASSWORD_ALPHABET =
	'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// Генератор для админа: 14 символов без похожих глифов (0/O, 1/l/I),
// чтобы пароль можно было продиктовать по телефону без переспросов.
const generatePassword = (length = 14) => {
	const values = new Uint32Array(length)

	if (window.crypto?.getRandomValues) {
		window.crypto.getRandomValues(values)
	} else {
		for (let i = 0; i < length; i += 1) {
			values[i] = Math.floor(Math.random() * PASSWORD_ALPHABET.length)
		}
	}

	return Array.from(values)
		.map(value => PASSWORD_ALPHABET[value % PASSWORD_ALPHABET.length])
		.join('')
}

const formatDateTime = value => {
	if (!value) return '—'

	try {
		return new Date(value).toLocaleString('ru-RU')
	} catch {
		return '—'
	}
}

const getUserStateLabel = user => {
	if (user.is_deleted) return 'Удалён'
	if (!user.is_active) return 'Отключён'
	return 'Активен'
}

const getUserStateClass = user => {
	if (user.is_deleted) return 'deleted'
	if (!user.is_active) return 'disabled'
	return 'active'
}

export default function PortalUsersModal({
	isOpen,
	client,
	onClose,
	onChanged,
}) {
	const clientId = client?.id || null

	const [activeTab, setActiveTab] = useState(TAB_USERS)

	const [users, setUsers] = useState([])
	const [canManage, setCanManage] = useState(false)
	const [loading, setLoading] = useState(false)
	const [actionLoading, setActionLoading] = useState(false)
	const [error, setError] = useState('')
	const [success, setSuccess] = useState('')

	const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM)

	const [selectedUserId, setSelectedUserId] = useState('')
	const [permissions, setPermissions] = useState([])
	const [checkedCodes, setCheckedCodes] = useState(new Set())
	const [permissionsLoading, setPermissionsLoading] = useState(false)
	const [permissionsDirty, setPermissionsDirty] = useState(false)

	const [passwordUserId, setPasswordUserId] = useState(null)
	const [passwordValue, setPasswordValue] = useState('')

	const selectedUser = useMemo(
		() =>
			users.find(user => String(user.id) === String(selectedUserId)) || null,
		[users, selectedUserId],
	)

	const clientTitle =
		client?.company_name ||
		client?.name ||
		(clientId ? `Клиент #${clientId}` : '')

	useEffect(() => {
		if (!isOpen || !clientId) return

		setActiveTab(TAB_USERS)
		setError('')
		setSuccess('')
		setCreateForm(EMPTY_CREATE_FORM)
		setSelectedUserId('')
		setPermissions([])
		setCheckedCodes(new Set())
		setPermissionsDirty(false)
		setPasswordUserId(null)
		setPasswordValue('')

		fetchUsers()
	}, [isOpen, clientId])

	// Переключились на другого пользователя — подтягиваем его галочки.
	useEffect(() => {
		if (!isOpen || !clientId) return
		if (activeTab !== TAB_PERMISSIONS) return
		if (!selectedUserId) {
			setPermissions([])
			setCheckedCodes(new Set())
			setPermissionsDirty(false)
			return
		}

		fetchUserPermissions(selectedUserId)
	}, [isOpen, clientId, activeTab, selectedUserId])

	const readError = async (res, fallback) => {
		const data = await res.json().catch(() => null)
		return data?.detail || fallback
	}

	const fetchUsers = async () => {
		setLoading(true)
		setError('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/clients/${clientId}/portal-users`,
				{ headers: getAuthHeaders() },
			)

			if (!res.ok) {
				throw new Error(
					await readError(res, 'Не удалось загрузить учётные записи портала'),
				)
			}

			const data = await res.json()

			setUsers(Array.isArray(data.users) ? data.users : [])
			setCanManage(Boolean(data.can_manage))
		} catch (err) {
			setError(err.message)
			setUsers([])
		} finally {
			setLoading(false)
		}
	}

	const fetchUserPermissions = async userId => {
		setPermissionsLoading(true)
		setError('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/clients/${clientId}/portal-users/${userId}/permissions`,
				{ headers: getAuthHeaders() },
			)

			if (!res.ok) {
				throw new Error(await readError(res, 'Не удалось загрузить доступы'))
			}

			const data = await res.json()
			const list = Array.isArray(data.permissions) ? data.permissions : []

			setPermissions(list)
			setCheckedCodes(
				new Set(list.filter(item => item.checked).map(item => item.code)),
			)
			setPermissionsDirty(false)
		} catch (err) {
			setError(err.message)
			setPermissions([])
			setCheckedCodes(new Set())
		} finally {
			setPermissionsLoading(false)
		}
	}

	const notifyChanged = () => {
		if (typeof onChanged === 'function') onChanged()
	}

	const handleCreateSubmit = async e => {
		e.preventDefault()

		if (!canManage) return

		setActionLoading(true)
		setError('')
		setSuccess('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/clients/${clientId}/portal-users`,
				{
					method: 'POST',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({
						email: createForm.email.trim(),
						name: createForm.name.trim(),
						password: createForm.password,
					}),
				},
			)

			if (!res.ok) {
				throw new Error(
					await readError(res, 'Не удалось создать учётную запись'),
				)
			}

			const created = await res.json()

			setSuccess(
				`Учётная запись ${created.email} создана. Передайте клиенту логин и пароль — ` +
					'посмотреть пароль позже будет нельзя, только задать новый.',
			)
			setCreateForm(EMPTY_CREATE_FORM)

			await fetchUsers()
			setActiveTab(TAB_USERS)
			notifyChanged()
		} catch (err) {
			setError(err.message)
		} finally {
			setActionLoading(false)
		}
	}

	const handleToggleActive = async user => {
		if (!canManage) return

		const nextActive = user.is_deleted || !user.is_active

		const confirmText = nextActive
			? `Включить доступ для «${user.email}»?`
			: `Отключить доступ для «${user.email}»? Пользователь не сможет войти в кабинет.`

		if (!window.confirm(confirmText)) return

		setActionLoading(true)
		setError('')
		setSuccess('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/clients/${clientId}/portal-users/${user.id}`,
				{
					method: 'PATCH',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({ is_active: nextActive }),
				},
			)

			if (!res.ok) {
				throw new Error(
					await readError(res, 'Не удалось изменить учётную запись'),
				)
			}

			setSuccess(nextActive ? 'Доступ включён' : 'Доступ отключён')
			await fetchUsers()
			notifyChanged()
		} catch (err) {
			setError(err.message)
		} finally {
			setActionLoading(false)
		}
	}

	const handleDelete = async user => {
		if (!canManage) return

		const confirmText =
			`Удалить учётную запись «${user.email}»?\n\n` +
			'Вход закроется, но запись останется в истории — её можно будет включить обратно. ' +
			'Завести второго пользователя с этим же email будет нельзя.'

		if (!window.confirm(confirmText)) return

		setActionLoading(true)
		setError('')
		setSuccess('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/clients/${clientId}/portal-users/${user.id}`,
				{
					method: 'DELETE',
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				throw new Error(
					await readError(res, 'Не удалось удалить учётную запись'),
				)
			}

			setSuccess('Учётная запись удалена')
			await fetchUsers()
			notifyChanged()
		} catch (err) {
			setError(err.message)
		} finally {
			setActionLoading(false)
		}
	}

	const openPasswordForm = user => {
		setPasswordUserId(user.id)
		setPasswordValue(generatePassword())
		setError('')
		setSuccess('')
	}

	const closePasswordForm = () => {
		setPasswordUserId(null)
		setPasswordValue('')
	}

	const handlePasswordSubmit = async (e, user) => {
		e.preventDefault()

		if (!canManage) return

		setActionLoading(true)
		setError('')
		setSuccess('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/clients/${clientId}/portal-users/${user.id}/password`,
				{
					method: 'POST',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({ password: passwordValue }),
				},
			)

			if (!res.ok) {
				throw new Error(await readError(res, 'Не удалось задать пароль'))
			}

			setSuccess(
				`Пароль для ${user.email} обновлён. Передайте его клиенту — ` +
					'посмотреть его позже будет нельзя.',
			)
			closePasswordForm()
		} catch (err) {
			setError(err.message)
		} finally {
			setActionLoading(false)
		}
	}

	const togglePermission = permission => {
		if (permission.is_locked) return
		if (!canManage) return

		setCheckedCodes(prev => {
			const next = new Set(prev)

			if (next.has(permission.code)) {
				next.delete(permission.code)
			} else {
				next.add(permission.code)
			}

			return next
		})

		setPermissionsDirty(true)
	}

	const resetPermissionsToStandard = () => {
		if (!canManage) return

		setCheckedCodes(
			new Set(
				permissions
					.filter(item => item.in_role_standard || item.is_locked)
					.map(item => item.code),
			),
		)

		setPermissionsDirty(true)
	}

	const handlePermissionsSave = async () => {
		if (!canManage || !selectedUserId) return

		setActionLoading(true)
		setError('')
		setSuccess('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/clients/${clientId}/portal-users/${selectedUserId}/permissions`,
				{
					method: 'PUT',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({
						permission_codes: Array.from(checkedCodes),
						reason: 'Настройка доступов из карточки клиента',
					}),
				},
			)

			if (!res.ok) {
				throw new Error(await readError(res, 'Не удалось сохранить доступы'))
			}

			const data = await res.json()
			const list = Array.isArray(data.permissions) ? data.permissions : []

			setPermissions(list)
			setCheckedCodes(
				new Set(list.filter(item => item.checked).map(item => item.code)),
			)
			setPermissionsDirty(false)

			setSuccess(
				data.changed_codes?.length > 0
					? `Доступы сохранены. Изменено: ${data.changed_codes.length}.`
					: 'Изменений не было.',
			)
		} catch (err) {
			setError(err.message)
		} finally {
			setActionLoading(false)
		}
	}

	const activeUsersForPermissions = users.filter(user => !user.is_deleted)

	if (!isOpen || !clientId) return null

	return (
		<div className='modal-overlay open' onClick={onClose}>
			<div
				className='modal-window portal-users-modal'
				onClick={e => e.stopPropagation()}
			>
				<style>{`
					.portal-users-modal {
						max-width: 980px;
						width: 96%;
					}

					.portal-users-layout {
						display: grid;
						grid-template-columns: 220px 1fr;
						gap: 0;
						min-height: 420px;
					}

					.portal-users-sidebar {
						border-right: 1px solid #eee;
						background: #fafafa;
						padding: 12px 0;
						display: flex;
						flex-direction: column;
						gap: 2px;
					}

					.portal-users-tab {
						text-align: left;
						border: none;
						background: transparent;
						padding: 10px 16px;
						font-size: 14px;
						color: #444;
						cursor: pointer;
						border-left: 3px solid transparent;
					}

					.portal-users-tab:hover {
						background: #f0f4ea;
					}

					.portal-users-tab.active {
						background: #f0f4ea;
						border-left-color: #5e9424;
						color: #3f6b1a;
						font-weight: 600;
					}

					.portal-users-tab-count {
						margin-left: 6px;
						font-size: 12px;
						color: #888;
					}

					.portal-users-content {
						padding: 16px 20px 20px;
						max-height: 70vh;
						overflow-y: auto;
					}

					.portal-users-client {
						font-size: 12px;
						color: #777;
						margin-bottom: 12px;
					}

					.portal-users-banner {
						padding: 10px 12px;
						border-radius: 8px;
						font-size: 13px;
						line-height: 1.4;
						margin-bottom: 12px;
					}

					.portal-users-banner.error {
						background: #fdecea;
						border: 1px solid #f5c6cb;
						color: #b71c1c;
					}

					.portal-users-banner.success {
						background: #edf7e6;
						border: 1px solid #cfe6b8;
						color: #3f6b1a;
					}

					.portal-users-banner.info {
						background: #f4f6f8;
						border: 1px solid #e0e4e8;
						color: #555;
					}

					.portal-user-card {
						border: 1px solid #e6e6e6;
						border-radius: 8px;
						padding: 12px;
						margin-bottom: 10px;
						background: #fff;
					}

					.portal-user-card.disabled,
					.portal-user-card.deleted {
						background: #fbfbfb;
						opacity: 0.85;
					}

					.portal-user-card-top {
						display: flex;
						justify-content: space-between;
						align-items: flex-start;
						gap: 10px;
						flex-wrap: wrap;
					}

					.portal-user-email {
						font-weight: 600;
						font-size: 14px;
						color: #222;
						word-break: break-all;
					}

					.portal-user-meta {
						font-size: 12px;
						color: #777;
						margin-top: 4px;
						line-height: 1.5;
					}

					.portal-user-state {
						font-size: 11px;
						font-weight: 700;
						padding: 2px 8px;
						border-radius: 12px;
						white-space: nowrap;
					}

					.portal-user-state.active {
						background: #edf7e6;
						color: #3f6b1a;
						border: 1px solid #cfe6b8;
					}

					.portal-user-state.disabled {
						background: #fff4e5;
						color: #8a5b00;
						border: 1px solid #f0d9b0;
					}

					.portal-user-state.deleted {
						background: #fdecea;
						color: #b71c1c;
						border: 1px solid #f5c6cb;
					}

					.portal-user-actions {
						display: flex;
						gap: 8px;
						flex-wrap: wrap;
						margin-top: 10px;
					}

					.portal-users-form {
						display: grid;
						gap: 12px;
						max-width: 480px;
					}

					.portal-users-field {
						display: flex;
						flex-direction: column;
						gap: 4px;
					}

					.portal-users-field label {
						font-size: 12px;
						font-weight: 600;
						color: #555;
					}

					.portal-users-input {
						border: 1px solid #ddd;
						border-radius: 6px;
						padding: 8px 10px;
						font-size: 14px;
						width: 100%;
						box-sizing: border-box;
					}

					.portal-users-hint {
						font-size: 12px;
						color: #888;
						line-height: 1.4;
					}

					.portal-users-password-row {
						display: flex;
						gap: 8px;
						align-items: center;
					}

					.portal-permission-row {
						display: flex;
						gap: 10px;
						align-items: flex-start;
						padding: 9px 10px;
						border: 1px solid #eee;
						border-radius: 8px;
						margin-bottom: 6px;
						cursor: pointer;
					}

					.portal-permission-row.checked {
						border-color: #cfe6b8;
						background: #f7fbf3;
					}

					.portal-permission-row.locked {
						cursor: not-allowed;
						background: #f6f6f6;
					}

					.portal-permission-title {
						font-size: 14px;
						color: #222;
						font-weight: 600;
					}

					.portal-permission-desc {
						font-size: 12px;
						color: #777;
						margin-top: 2px;
						line-height: 1.4;
					}

					.portal-permission-flag {
						display: inline-block;
						margin-left: 6px;
						font-size: 11px;
						font-weight: 700;
						padding: 1px 7px;
						border-radius: 10px;
						white-space: nowrap;
					}

					.portal-permission-flag.locked {
						background: #eef2f7;
						color: #48566b;
						border: 1px solid #d7dfe9;
					}

					.portal-permission-flag.added {
						background: #edf7e6;
						color: #3f6b1a;
						border: 1px solid #cfe6b8;
					}

					.portal-permission-flag.removed {
						background: #fff4e5;
						color: #8a5b00;
						border: 1px solid #f0d9b0;
					}

					.portal-permissions-toolbar {
						display: flex;
						justify-content: space-between;
						align-items: center;
						gap: 10px;
						flex-wrap: wrap;
						margin-bottom: 12px;
					}

					@media (max-width: 720px) {
						.portal-users-layout {
							grid-template-columns: 1fr;
						}

						.portal-users-sidebar {
							flex-direction: row;
							overflow-x: auto;
							border-right: none;
							border-bottom: 1px solid #eee;
						}

						.portal-users-tab {
							border-left: none;
							border-bottom: 3px solid transparent;
							white-space: nowrap;
						}

						.portal-users-tab.active {
							border-left: none;
							border-bottom-color: #5e9424;
						}
					}
				`}</style>

				<div className='modal-header'>
					<span className='modal-title'>Настройка пользователей портала</span>

					<button className='modal-close' type='button' onClick={onClose}>
						&times;
					</button>
				</div>

				<div className='portal-users-layout'>
					<div className='portal-users-sidebar'>
						<button
							type='button'
							className={`portal-users-tab ${activeTab === TAB_USERS ? 'active' : ''}`}
							onClick={() => setActiveTab(TAB_USERS)}
						>
							Пользователи
							<span className='portal-users-tab-count'>{users.length}</span>
						</button>

						{canManage && (
							<button
								type='button'
								className={`portal-users-tab ${activeTab === TAB_CREATE ? 'active' : ''}`}
								onClick={() => setActiveTab(TAB_CREATE)}
							>
								Создать пользователя
							</button>
						)}

						<button
							type='button'
							className={`portal-users-tab ${activeTab === TAB_PERMISSIONS ? 'active' : ''}`}
							onClick={() => setActiveTab(TAB_PERMISSIONS)}
						>
							Настройка доступов
						</button>
					</div>

					<div className='portal-users-content'>
						<div className='portal-users-client'>Клиент: {clientTitle}</div>

						{error && <div className='portal-users-banner error'>{error}</div>}
						{success && (
							<div className='portal-users-banner success'>{success}</div>
						)}

						{!canManage && (
							<div className='portal-users-banner info'>
								У вас есть доступ только на просмотр. Создание учётных записей и
								изменение доступов требует права «Учётные записи портала:
								управление».
							</div>
						)}

						{activeTab === TAB_USERS && (
							<>
								{loading ? (
									<div className='portal-users-hint'>Загрузка...</div>
								) : users.length === 0 ? (
									<div className='portal-users-banner info'>
										У этого клиента пока нет учётных записей портала.
										{canManage &&
											' Создайте первую во вкладке «Создать пользователя».'}
									</div>
								) : (
									users.map(user => (
										<div
											key={user.id}
											className={`portal-user-card ${getUserStateClass(user)}`}
										>
											<div className='portal-user-card-top'>
												<div>
													<div className='portal-user-email'>{user.email}</div>
													<div className='portal-user-meta'>
														{user.name}
														<br />
														Создан: {formatDateTime(user.created_at)}
														<br />
														Последний вход: {formatDateTime(user.last_login_at)}
													</div>
												</div>

												<span
													className={`portal-user-state ${getUserStateClass(user)}`}
												>
													{getUserStateLabel(user)}
												</span>
											</div>

											{canManage && (
												<div className='portal-user-actions'>
													<button
														type='button'
														className='btn-details'
														onClick={() => handleToggleActive(user)}
														disabled={actionLoading}
													>
														{user.is_deleted || !user.is_active
															? 'Включить'
															: 'Отключить'}
													</button>

													{!user.is_deleted && (
														<button
															type='button'
															className='btn-details'
															onClick={() => openPasswordForm(user)}
															disabled={actionLoading}
														>
															Задать пароль
														</button>
													)}

													<button
														type='button'
														className='btn-details'
														onClick={() => {
															setSelectedUserId(String(user.id))
															setActiveTab(TAB_PERMISSIONS)
														}}
														disabled={actionLoading || user.is_deleted}
													>
														Доступы
													</button>

													{!user.is_deleted && (
														<button
															type='button'
															className='btn-details'
															onClick={() => handleDelete(user)}
															disabled={actionLoading}
														>
															Удалить
														</button>
													)}
												</div>
											)}

											{passwordUserId === user.id && (
												<form
													className='portal-users-form'
													style={{ marginTop: 12 }}
													onSubmit={e => handlePasswordSubmit(e, user)}
												>
													<div className='portal-users-field'>
														<label>Новый пароль</label>

														<div className='portal-users-password-row'>
															<input
																className='portal-users-input'
																value={passwordValue}
																onChange={e => setPasswordValue(e.target.value)}
																minLength={8}
																required
															/>

															<button
																type='button'
																className='btn-details'
																onClick={() =>
																	setPasswordValue(generatePassword())
																}
															>
																Сгенерировать
															</button>
														</div>

														<span className='portal-users-hint'>
															Минимум 8 символов. Скопируйте пароль сейчас —
															после сохранения посмотреть его будет нельзя,
															только задать новый.
														</span>
													</div>

													<div style={{ display: 'flex', gap: 8 }}>
														<button
															type='submit'
															className='btn-green'
															disabled={actionLoading}
														>
															{actionLoading
																? 'Сохранение...'
																: 'Сохранить пароль'}
														</button>

														<button
															type='button'
															className='btn-details'
															onClick={closePasswordForm}
														>
															Отмена
														</button>
													</div>
												</form>
											)}
										</div>
									))
								)}
							</>
						)}

						{activeTab === TAB_CREATE && canManage && (
							<form className='portal-users-form' onSubmit={handleCreateSubmit}>
								<div className='portal-users-field'>
									<label>Email (он же логин)</label>
									<input
										className='portal-users-input'
										type='text'
										value={createForm.email}
										onChange={e =>
											setCreateForm(prev => ({
												...prev,
												email: e.target.value,
											}))
										}
										placeholder='ivanov@amonitoring.kz'
										required
									/>
									<span className='portal-users-hint'>
										Обязателен символ @. Если своей почты у клиента нет,
										придумайте адрес на нашем домене. Изменить его потом нельзя
										— только завести новую учётную запись.
									</span>
								</div>

								<div className='portal-users-field'>
									<label>Имя пользователя</label>
									<input
										className='portal-users-input'
										type='text'
										value={createForm.name}
										onChange={e =>
											setCreateForm(prev => ({ ...prev, name: e.target.value }))
										}
										placeholder='Иванов Иван'
										required
									/>
								</div>

								<div className='portal-users-field'>
									<label>Пароль</label>

									<div className='portal-users-password-row'>
										<input
											className='portal-users-input'
											type='text'
											value={createForm.password}
											onChange={e =>
												setCreateForm(prev => ({
													...prev,
													password: e.target.value,
												}))
											}
											minLength={8}
											required
										/>

										<button
											type='button'
											className='btn-details'
											onClick={() =>
												setCreateForm(prev => ({
													...prev,
													password: generatePassword(),
												}))
											}
										>
											Сгенерировать
										</button>
									</div>

									<span className='portal-users-hint'>
										Минимум 8 символов. Пароль показывается только сейчас —
										сохраните его перед созданием.
									</span>
								</div>

								<div className='portal-users-banner info'>
									Новая учётная запись получит стандартный набор доступов роли
									«Клиент (портал)». Изменить его для конкретного пользователя
									можно во вкладке «Настройка доступов».
								</div>

								<div>
									<button
										type='submit'
										className='btn-green'
										disabled={actionLoading}
									>
										{actionLoading ? 'Создание...' : 'Создать пользователя'}
									</button>
								</div>
							</form>
						)}

						{activeTab === TAB_PERMISSIONS && (
							<>
								<div
									className='portal-users-field'
									style={{ marginBottom: 14 }}
								>
									<label>Пользователь</label>

									<select
										className='portal-users-input'
										value={selectedUserId}
										onChange={e => setSelectedUserId(e.target.value)}
									>
										<option value=''>— выберите пользователя —</option>

										{activeUsersForPermissions.map(user => (
											<option key={user.id} value={user.id}>
												{user.email}
												{user.name ? ` · ${user.name}` : ''}
												{user.is_active ? '' : ' (отключён)'}
											</option>
										))}
									</select>
								</div>

								{!selectedUserId ? (
									<div className='portal-users-banner info'>
										Выберите пользователя, чтобы настроить его доступы. Галочки
										по умолчанию совпадают со стандартом роли — отличия
										сохраняются только там, где вы их поставите.
									</div>
								) : permissionsLoading ? (
									<div className='portal-users-hint'>Загрузка доступов...</div>
								) : (
									<>
										<div className='portal-permissions-toolbar'>
											<div className='portal-users-hint'>
												Отмечено: {checkedCodes.size} из {permissions.length}
											</div>

											{canManage && (
												<button
													type='button'
													className='btn-details'
													onClick={resetPermissionsToStandard}
													disabled={actionLoading}
												>
													Вернуть стандарт роли
												</button>
											)}
										</div>

										{permissions.map(permission => {
											const checked = checkedCodes.has(permission.code)

											const flag = permission.is_locked
												? { className: 'locked', text: 'обязательное' }
												: checked && !permission.in_role_standard
													? { className: 'added', text: 'сверх стандарта' }
													: !checked && permission.in_role_standard
														? { className: 'removed', text: 'снято' }
														: null

											return (
												<label
													key={permission.code}
													className={`portal-permission-row ${checked ? 'checked' : ''} ${
														permission.is_locked ? 'locked' : ''
													}`}
													title={permission.code}
												>
													<input
														type='checkbox'
														checked={checked}
														disabled={permission.is_locked || !canManage}
														onChange={() => togglePermission(permission)}
													/>

													<span>
														<span className='portal-permission-title'>
															{permission.name}

															{flag && (
																<span
																	className={`portal-permission-flag ${flag.className}`}
																>
																	{flag.text}
																</span>
															)}
														</span>

														{permission.description && (
															<span className='portal-permission-desc'>
																{permission.description}
															</span>
														)}
													</span>
												</label>
											)
										})}

										{canManage && (
											<div style={{ marginTop: 14 }}>
												<button
													type='button'
													className='btn-green'
													onClick={handlePermissionsSave}
													disabled={actionLoading || !permissionsDirty}
												>
													{actionLoading
														? 'Сохранение...'
														: permissionsDirty
															? 'Сохранить доступы'
															: 'Изменений нет'}
												</button>
											</div>
										)}
									</>
								)}
							</>
						)}
					</div>
				</div>

				<div className='modal-footer'>
					<button type='button' className='btn-details' onClick={onClose}>
						Закрыть
					</button>
				</div>
			</div>
		</div>
	)
}
