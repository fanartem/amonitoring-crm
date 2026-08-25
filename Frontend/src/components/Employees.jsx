import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import '../styles/Employees.css'

const DEFAULT_ROLE_COLOR = '#64748B'

const DATA_SCOPE_LABELS = {
	ALL: 'Все данные',
	CITY: 'Свой город',
	RESPONSIBLE_CLIENTS: 'Свои клиенты',
	ASSIGNED: 'Назначенное',
	CITY_ASSIGNED: 'Город + назначенное',
	OWN: 'Только своё',
	NONE: 'Без области',
}

const CATEGORY_LABELS = {
	requests: 'Заявки',
	attachments: 'Файлы',
	clients: 'Клиенты',
	vehicles: 'Автомобили',
	prices: 'Цены',
	warehouse: 'Склад',
	employees: 'Сотрудники',
	roles: 'Роли и доступы',
	settings: 'Настройки',
	notifications: 'Уведомления',
	support_requests: 'Тех. поддержка',
	calendar: 'Календарь',
	general: 'Общие',
	reports: 'Отчёты',
}

const getStoredUser = () => {
	try {
		return JSON.parse(localStorage.getItem('user_data') || 'null') || {}
	} catch {
		return {}
	}
}

const toBool = value => value === true || value === 1 || value === '1'

const isSuperAdmin = user => toBool(user?.is_super_admin)
const isOwner = user => toBool(user?.is_owner)

const hasPermission = (user, permissionCode) => {
	if (isSuperAdmin(user)) return true
	return (
		Array.isArray(user?.permissions) &&
		user.permissions.includes(permissionCode)
	)
}

const normalizeRoleCode = value =>
	String(value || '')
		.trim()
		.toUpperCase()

const normalizeHexColor = value => {
	const color = String(value || '').trim()
	return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : DEFAULT_ROLE_COLOR
}

const hexToRgba = (hexColor, alpha = 0.14) => {
	const color = normalizeHexColor(hexColor).replace('#', '')
	const r = parseInt(color.slice(0, 2), 16)
	const g = parseInt(color.slice(2, 4), 16)
	const b = parseInt(color.slice(4, 6), 16)

	return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const getRoleBadgeStyle = role => {
	const color = normalizeHexColor(role?.badge_color || role?.role_badge_color)

	return {
		backgroundColor: hexToRgba(color, 0.16),
		color,
		borderColor: hexToRgba(color, 0.35),
	}
}

export default function Employees() {
	const currentUser = getStoredUser()
	const currentUserId = Number(currentUser?.id || 0)

	const [employees, setEmployees] = useState([])
	const [cities, setCities] = useState([])
	const [roleOptions, setRoleOptions] = useState([])
	const [permissions, setPermissions] = useState([])

	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')

	const [isModalOpen, setIsModalOpen] = useState(false)
	const [selectedUser, setSelectedUser] = useState(null)
	const [formData, setFormData] = useState({
		email: '',
		name: '',
		password: '',
		role: '',
		city: '',
	})

	const [isAccessModalOpen, setIsAccessModalOpen] = useState(false)
	const [accessDetail, setAccessDetail] = useState(null)
	const [accessLoading, setAccessLoading] = useState(false)
	const [accessError, setAccessError] = useState('')
	const [overrideDraft, setOverrideDraft] = useState([])
	const [accessSaving, setAccessSaving] = useState(false)

	const [openFolders, setOpenFolders] = useState(
		currentUser?.role ? { [currentUser.role]: true } : {},
	)

	const canManageEmployees = hasPermission(currentUser, 'employees.manage')
	const canDeleteEmployees = hasPermission(currentUser, 'employees.delete')
	const canManageAccess = isSuperAdmin(currentUser)

	const isCurrentUser = emp => Number(emp?.id) === currentUserId

	const canEditEmployee = emp => {
		if (!emp) return false
		if (!canManageEmployees) return false
		if (isOwner(emp) && !isOwner(currentUser)) return false
		return true
	}

	const canDeleteEmployee = emp => {
		if (!emp) return false
		if (!canDeleteEmployees) return false
		if (isCurrentUser(emp)) return false
		if (isOwner(emp)) return false
		if (toBool(emp.is_super_admin) && !isOwner(currentUser)) return false
		return true
	}

	const canChangeRole = emp => {
		if (!emp) return false
		if (!isSuperAdmin(currentUser)) return false
		if (isOwner(emp)) return false
		return true
	}

	const roleMap = useMemo(() => {
		const map = new Map()
		roleOptions.forEach(role => map.set(role.code, role))
		return map
	}, [roleOptions])

	const permissionMap = useMemo(() => {
		const map = new Map()
		permissions.forEach(permission => map.set(permission.code, permission))
		return map
	}, [permissions])

	const permissionOptions = useMemo(() => {
		return [...permissions].sort((a, b) => {
			const categoryCompare = String(a.category || '').localeCompare(
				String(b.category || ''),
				'ru',
			)

			if (categoryCompare !== 0) return categoryCompare

			return String(a.name || a.code).localeCompare(
				String(b.name || b.code),
				'ru',
			)
		})
	}, [permissions])

	const groupedPermissionOptions = useMemo(() => {
		return permissionOptions.reduce((acc, permission) => {
			const category = String(permission.category || 'general').toLowerCase()

			if (!acc[category]) acc[category] = []

			acc[category].push(permission)

			return acc
		}, {})
	}, [permissionOptions])

	const rolesForFolders = useMemo(() => {
		const map = new Map()

		roleOptions.forEach(role => {
			map.set(role.code, role)
		})

		employees.forEach(emp => {
			const roleCode = normalizeRoleCode(emp.role)

			if (!roleCode || map.has(roleCode)) return

			map.set(roleCode, {
				code: roleCode,
				name: emp.role_name || roleCode,
				badge_color: emp.role_badge_color || DEFAULT_ROLE_COLOR,
				sort_order: 999,
				is_active: true,
			})
		})

		return Array.from(map.values()).sort((a, b) => {
			const orderCompare =
				Number(a.sort_order || 999) - Number(b.sort_order || 999)

			if (orderCompare !== 0) return orderCompare

			return String(a.name || a.code).localeCompare(
				String(b.name || b.code),
				'ru',
			)
		})
	}, [roleOptions, employees])

	const visibleEmployees = useMemo(() => {
		return employees.filter(emp => {
			if (emp.email !== 'admin@amonitoring.kz') return true
			return isCurrentUser(emp) || isSuperAdmin(currentUser)
		})
	}, [employees, currentUserId, currentUser])

	const grouped = useMemo(() => {
		return rolesForFolders.reduce((acc, role) => {
			const members = visibleEmployees
				.filter(
					emp => normalizeRoleCode(emp.role) === normalizeRoleCode(role.code),
				)
				.sort((a, b) => {
					if (isCurrentUser(a)) return -1
					if (isCurrentUser(b)) return 1
					return String(a.name || '').localeCompare(String(b.name || ''), 'ru')
				})

			if (members.length > 0) {
				acc[role.code] = {
					role,
					members,
				}
			}

			return acc
		}, {})
	}, [rolesForFolders, visibleEmployees, currentUserId])

	useEffect(() => {
		fetchEmployees()
		fetchCities()
		fetchRoleOptions()

		if (canManageAccess) {
			fetchPermissions()
		}
	}, [])

	useEffect(() => {
		if (!currentUser?.role) return

		setOpenFolders(prev => ({
			...prev,
			[currentUser.role]: true,
		}))
	}, [currentUser?.role])

	const fetchEmployees = async () => {
		setLoading(true)
		setError('')

		try {
			const res = await fetch(`${API_BASE_URL}/admin/users`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить сотрудников')
			}

			const data = await res.json()
			setEmployees(Array.isArray(data) ? data : [])
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

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

	const fetchRoleOptions = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/access/role-options`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				setRoleOptions([])
				return
			}

			const data = await res.json()
			setRoleOptions(Array.isArray(data) ? data : [])
		} catch (err) {
			console.error('Ошибка загрузки ролей:', err)
			setRoleOptions([])
		}
	}

	const fetchPermissions = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/access/permissions`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				setPermissions([])
				return
			}

			const data = await res.json()
			setPermissions(Array.isArray(data.permissions) ? data.permissions : [])
		} catch (err) {
			console.error('Ошибка загрузки permissions:', err)
			setPermissions([])
		}
	}

	const fetchUserAccessDetail = async userId => {
		setAccessLoading(true)
		setAccessError('')

		try {
			if (permissions.length === 0) {
				await fetchPermissions()
			}

			const res = await fetch(`${API_BASE_URL}/access/users/${userId}`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить доступы')
			}

			const data = await res.json()

			setAccessDetail(data)
			setOverrideDraft(
				Array.isArray(data.overrides)
					? data.overrides.map(item => ({
							permission_code: item.code,
							effect: item.effect,
						}))
					: [],
			)
		} catch (err) {
			setAccessError(err.message)
		} finally {
			setAccessLoading(false)
		}
	}

	const toggleFolder = roleCode => {
		setOpenFolders(prev => ({ ...prev, [roleCode]: !prev[roleCode] }))
	}

	const getRoleMeta = roleCode => {
		const normalized = normalizeRoleCode(roleCode)

		return (
			roleMap.get(normalized) || {
				code: normalized,
				name: normalized || 'Роль не указана',
				badge_color: DEFAULT_ROLE_COLOR,
				data_scope: null,
				can_be_request_executor: false,
				can_be_responsible_manager: false,
			}
		)
	}

	const getEmployeeRoleMeta = emp => {
		const meta = getRoleMeta(emp?.role)

		return {
			...meta,
			name: emp?.role_name || meta.name || emp?.role,
			badge_color:
				emp?.role_badge_color || meta.badge_color || DEFAULT_ROLE_COLOR,
			data_scope: emp?.role_data_scope || meta.data_scope,
		}
	}

	const getPositionName = emp => {
		return (
			emp?.position_name || emp?.position || emp?.role_name || emp?.role || '—'
		)
	}

	const roleRequiresCity = roleCode => {
		const role = getRoleMeta(roleCode)
		return toBool(role.can_be_request_executor)
	}

	const handleDelete = async emp => {
		if (!canDeleteEmployee(emp)) return

		if (!window.confirm(`Удалить сотрудника ${emp.name}?`)) return

		try {
			const response = await fetch(`${API_BASE_URL}/admin/users/${emp.id}`, {
				method: 'DELETE',
				headers: getAuthHeaders(),
			})

			if (!response.ok) {
				const data = await response.json().catch(() => null)
				throw new Error(data?.detail || 'Ошибка удаления')
			}

			fetchEmployees()
		} catch (err) {
			alert(err.message)
		}
	}

	const handleEdit = emp => {
		setSelectedUser(emp)
		setFormData({
			email: emp.email || '',
			name: emp.name || '',
			password: '',
			role: emp.role || '',
			city: emp.city || '',
		})
		setIsModalOpen(true)
	}

	const handleChange = e => {
		const { name, value } = e.target
		setFormData(prev => ({ ...prev, [name]: value }))
	}

	const handleRoleChange = e => {
		const nextRole = e.target.value

		setFormData(prev => ({
			...prev,
			role: nextRole,
		}))
	}

	const handleSave = async () => {
		if (!selectedUser) return

		try {
			const body = {}
			const canEditIdentityFields = canManageEmployees && !isOwner(selectedUser)
			const canEditCityField = canManageEmployees && !isOwner(selectedUser)
			const canEditRoleField = canChangeRole(selectedUser)

			if (canEditIdentityFields) {
				body.email = formData.email
				body.name = formData.name
			}

			if (canEditCityField) {
				body.city = formData.city || null
			}

			if (canEditRoleField) {
				body.role = formData.role
				body.city = formData.city || null
			}

			if (formData.password) {
				body.password = formData.password
			}

			if (Object.keys(body).length === 0) {
				alert('Нет данных для сохранения')
				return
			}

			if (body.role && roleRequiresCity(body.role) && !body.city) {
				alert('Для роли исполнителя заявки необходимо указать город')
				return
			}

			const response = await fetch(
				`${API_BASE_URL}/admin/users/${selectedUser.id}`,
				{
					method: 'PUT',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify(body),
				},
			)

			if (!response.ok) {
				const data = await response.json().catch(() => null)
				throw new Error(data?.detail || 'Ошибка обновления')
			}

			setIsModalOpen(false)
			setSelectedUser(null)
			fetchEmployees()
		} catch (err) {
			alert(err.message)
		}
	}

	const handleOpenAccess = emp => {
		if (!canManageAccess) return

		setAccessDetail(null)
		setOverrideDraft([])
		setAccessError('')
		setIsAccessModalOpen(true)
		fetchUserAccessDetail(emp.id)
	}

	const handleCloseAccess = () => {
		setIsAccessModalOpen(false)
		setAccessDetail(null)
		setAccessError('')
		setOverrideDraft([])
	}

	const getPermissionLabel = permission => {
		return permission?.name || permission?.code || 'Без названия'
	}

	const getPermissionDescription = permission => {
		return permission?.description || permission?.code || ''
	}

	const rolePermissionCodes = useMemo(() => {
		if (!accessDetail?.role_permissions) return new Set()
		return new Set(accessDetail.role_permissions.map(item => item.code))
	}, [accessDetail])

	const lockedCoreCodes = useMemo(() => {
		if (!accessDetail?.role_permissions) return new Set()

		return new Set(
			accessDetail.role_permissions
				.filter(item => toBool(item.is_locked_core))
				.map(item => item.code),
		)
	}, [accessDetail])

	const effectivePermissionCodes = useMemo(() => {
		if (!accessDetail?.user?.permissions) return new Set()
		return new Set(accessDetail.user.permissions)
	}, [accessDetail])

	const overrideMap = useMemo(() => {
		const map = new Map()

		overrideDraft.forEach(item => {
			map.set(item.permission_code, item.effect)
		})

		return map
	}, [overrideDraft])

	const getPermissionChecked = permissionCode => {
		const overrideEffect = overrideMap.get(permissionCode)

		if (overrideEffect === 'ALLOW') return true
		if (overrideEffect === 'DENY') return false

		return rolePermissionCodes.has(permissionCode)
	}

	const handlePermissionToggle = (permissionCode, checked) => {
		if (!accessDetail?.user) return
		if (lockedCoreCodes.has(permissionCode)) return
		if (toBool(accessDetail.user.is_owner)) return
		if (toBool(accessDetail.user.is_super_admin)) return

		const roleHasPermission = rolePermissionCodes.has(permissionCode)

		setOverrideDraft(prev => {
			const withoutCurrent = prev.filter(
				item => item.permission_code !== permissionCode,
			)

			if (roleHasPermission && checked) {
				return withoutCurrent
			}

			if (!roleHasPermission && !checked) {
				return withoutCurrent
			}

			return [
				...withoutCurrent,
				{
					permission_code: permissionCode,
					effect: checked ? 'ALLOW' : 'DENY',
				},
			].sort((a, b) => a.permission_code.localeCompare(b.permission_code, 'ru'))
		})
	}

	const handleSaveOverrides = async () => {
		if (!accessDetail?.user) return

		setAccessSaving(true)

		try {
			const res = await fetch(
				`${API_BASE_URL}/access/users/${accessDetail.user.id}/permission-overrides`,
				{
					method: 'PATCH',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({
						overrides: overrideDraft,
						reason:
							'Изменение индивидуальных доступов через карточку сотрудника',
					}),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось сохранить доступы')
			}

			await fetchUserAccessDetail(accessDetail.user.id)
			await fetchEmployees()
		} catch (err) {
			alert(err.message)
		} finally {
			setAccessSaving(false)
		}
	}

	const handleToggleSuperAdmin = async () => {
		if (!accessDetail?.user) return

		const user = accessDetail.user
		const nextValue = !toBool(user.is_super_admin)

		const confirmText = nextValue
			? `Выдать Супер-Админа пользователю ${user.name}?`
			: `Снять Супер-Админа с пользователя ${user.name}?`

		if (!window.confirm(confirmText)) return

		setAccessSaving(true)

		try {
			const res = await fetch(
				`${API_BASE_URL}/access/users/${user.id}/security-flags`,
				{
					method: 'PATCH',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({
						is_super_admin: nextValue,
						reason: 'Изменение флага Супер-Админа через карточку сотрудника',
					}),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось изменить Супер-Админа')
			}

			await fetchUserAccessDetail(user.id)
			await fetchEmployees()
		} catch (err) {
			alert(err.message)
		} finally {
			setAccessSaving(false)
		}
	}

	const renderAccessRow = permission => {
		const permissionCode = permission.code
		const checked = getPermissionChecked(permissionCode)
		const locked = lockedCoreCodes.has(permissionCode)
		const overrideEffect = overrideMap.get(permissionCode)

		const disabled =
			locked ||
			!canManageAccess ||
			toBool(accessDetail?.user?.is_owner) ||
			toBool(accessDetail?.user?.is_super_admin)

		const label = getPermissionLabel(permission)
		const description = getPermissionDescription(permission)
		const showDescription =
			description && description !== label && description !== permissionCode

		return (
			<label
				key={permissionCode}
				className={`access-permission-row ${checked ? 'checked' : ''} ${
					disabled ? 'disabled' : ''
				}`}
				title={permissionCode}
			>
				<input
					type='checkbox'
					checked={checked}
					disabled={disabled}
					onChange={e =>
						handlePermissionToggle(permissionCode, e.target.checked)
					}
				/>

				<span className='access-permission-content'>
					<span className='access-permission-title'>{label}</span>

					{showDescription && (
						<span className='access-permission-description'>{description}</span>
					)}
				</span>

				<div className='access-permission-tags'>
					{locked && <span className='access-tag locked'>Обязательный</span>}

					{overrideEffect === 'ALLOW' && (
						<span className='access-tag allow'>Добавлено</span>
					)}

					{overrideEffect === 'DENY' && (
						<span className='access-tag deny'>Убрано</span>
					)}
				</div>
			</label>
		)
	}

	return (
		<div className='employees-page'>
			<div className='employees-header'>
				<h2>Сотрудники</h2>
			</div>

			<p className='employees-subtitle'>
				Список сотрудников доступен всем авторизованным пользователям.
			</p>

			{error && <div className='employees-error'>{error}</div>}

			{loading ? (
				<div>Загрузка...</div>
			) : Object.keys(grouped).length === 0 ? (
				<div className='employees-empty'>Сотрудники не найдены</div>
			) : (
				<div className='emp-folders'>
					{Object.entries(grouped).map(([roleCode, group]) => {
						const { role, members } = group
						const isOpen = !!openFolders[roleCode]
						const folderColor = normalizeHexColor(role.badge_color)
						const hasCurrentUser = members.some(isCurrentUser)

						return (
							<div
								key={roleCode}
								className={`emp-folder ${isOpen ? 'open' : ''}`}
							>
								<button
									className='emp-folder-header'
									onClick={() => toggleFolder(roleCode)}
									style={{
										'--folder-color': hexToRgba(folderColor, 0.14),
									}}
								>
									<span className='emp-folder-icon'>
										{isOpen ? '📂' : '📁'}
									</span>

									<span className='emp-folder-title'>
										{role.name || role.code}
									</span>

									<span className='emp-folder-count'>{members.length}</span>

									{hasCurrentUser && (
										<span className='emp-folder-you-badge'>Вы здесь</span>
									)}

									<span className='emp-folder-chevron'>
										{isOpen ? '▲' : '▼'}
									</span>
								</button>

								{isOpen && (
									<div className='emp-folder-grid'>
										{members.map(emp => {
											const roleMeta = getEmployeeRoleMeta(emp)

											return (
												<div
													key={emp.id}
													className={`emp-card ${
														isCurrentUser(emp) ? 'current-user-card' : ''
													}`}
												>
													{isCurrentUser(emp) && (
														<div className='emp-you-tag'>Вы</div>
													)}

													<div className='emp-name'>{emp.name}</div>

													<div className='emp-email'>
														@{String(emp.email || '').split('@')[0]}
													</div>

													{emp.city && (
														<div className='emp-city'>📍 {emp.city}</div>
													)}

													<div className='emp-position-row'>
														<span className='emp-position-label'>Позиция</span>
														<span
															className='role-badge dynamic-role-badge'
															style={getRoleBadgeStyle(roleMeta)}
														>
															{getPositionName(emp)}
														</span>
													</div>

													{canManageAccess && (
														<>
															<div className='emp-role-tech-line'>
																Роль: {roleMeta.name || roleMeta.code}
															</div>

															<div className='emp-meta-badges'>
																{toBool(emp.is_owner) && (
																	<span className='emp-system-badge owner'>
																		OWNER
																	</span>
																)}

																{toBool(emp.is_super_admin) && (
																	<span className='emp-system-badge super'>
																		Супер-Админ
																	</span>
																)}
															</div>
														</>
													)}

													{roleMeta.data_scope && canManageAccess && (
														<div className='emp-access-scope'>
															Данные:{' '}
															{DATA_SCOPE_LABELS[roleMeta.data_scope] ||
																roleMeta.data_scope}
														</div>
													)}

													{(canEditEmployee(emp) ||
														canDeleteEmployee(emp) ||
														canManageAccess) && (
														<div className='emp-actions'>
															{canEditEmployee(emp) && (
																<button
																	className='btn-edit'
																	onClick={() => handleEdit(emp)}
																>
																	Изменить
																</button>
															)}

															{canManageAccess && (
																<button
																	className='btn-access'
																	onClick={() => handleOpenAccess(emp)}
																>
																	Доступы
																</button>
															)}

															{canDeleteEmployee(emp) && (
																<button
																	className='btn-delete'
																	onClick={() => handleDelete(emp)}
																>
																	Удалить
																</button>
															)}
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

			{isModalOpen && selectedUser && (
				<div className='employee-modal-overlay'>
					<div className='employee-modal'>
						<div className='employee-modal-header'>
							<h2>Редактирование сотрудника</h2>

							<button
								className='employee-modal-close'
								onClick={() => setIsModalOpen(false)}
							>
								×
							</button>
						</div>

						<div className='employee-modal-body'>
							{isOwner(selectedUser) && !isOwner(currentUser) && (
								<div className='employee-readonly-note'>
									Владелец системы защищён от редактирования.
								</div>
							)}

							<label>
								Имя
								<input
									type='text'
									name='name'
									placeholder='Имя'
									value={formData.name}
									onChange={handleChange}
									disabled={!canEditEmployee(selectedUser)}
								/>
							</label>

							<label>
								Email
								<input
									type='email'
									name='email'
									placeholder='Email'
									value={formData.email}
									onChange={handleChange}
									disabled={!canEditEmployee(selectedUser)}
								/>
							</label>

							<label>
								Новый пароль
								<input
									type='password'
									name='password'
									placeholder='Оставьте пустым, если не нужно менять'
									value={formData.password}
									onChange={handleChange}
								/>
							</label>

							{canChangeRole(selectedUser) && (
								<label>
									Роль
									<select
										name='role'
										value={formData.role}
										onChange={handleRoleChange}
									>
										{roleOptions.map(role => (
											<option key={role.code} value={role.code}>
												{role.name} ({role.code})
											</option>
										))}
									</select>
								</label>
							)}

							{canEditEmployee(selectedUser) && (
								<label>
									Город
									<select
										name='city'
										value={formData.city}
										onChange={handleChange}
									>
										<option value=''>Все города / без привязки</option>

										{cities.map(city => (
											<option key={city.id} value={city.name}>
												{city.name}
											</option>
										))}
									</select>
									{roleRequiresCity(formData.role) && (
										<span className='employee-field-hint'>
											Для этой роли город обязателен.
										</span>
									)}
								</label>
							)}
						</div>

						<div className='employee-modal-actions'>
							<button className='btn-save' onClick={handleSave}>
								Сохранить
							</button>

							<button
								className='btn-cancel'
								onClick={() => setIsModalOpen(false)}
							>
								Отмена
							</button>
						</div>
					</div>
				</div>
			)}

			{isAccessModalOpen && (
				<div className='employee-modal-overlay'>
					<div className='employee-modal employee-modal-wide'>
						<div className='employee-modal-header'>
							<h2>Доступы сотрудника</h2>

							<button
								className='employee-modal-close'
								onClick={handleCloseAccess}
							>
								×
							</button>
						</div>

						<div className='employee-modal-body employee-access-modal-body'>
							{accessLoading ? (
								<div className='employees-empty'>Загрузка доступов...</div>
							) : accessError ? (
								<div className='employees-error'>{accessError}</div>
							) : accessDetail?.user ? (
								<>
									<div className='access-user-summary'>
										<div>
											<div className='access-user-name'>
												{accessDetail.user.name}
											</div>
											<div className='access-user-email'>
												{accessDetail.user.email}
											</div>
										</div>

										<div className='access-user-badges'>
											<span
												className='role-badge dynamic-role-badge'
												style={getRoleBadgeStyle({
													badge_color: accessDetail.user.role_badge_color,
												})}
											>
												{accessDetail.user.role_name || accessDetail.user.role}
											</span>

											{toBool(accessDetail.user.is_owner) && (
												<span className='emp-system-badge owner'>OWNER</span>
											)}

											{toBool(accessDetail.user.is_super_admin) && (
												<span className='emp-system-badge super'>
													Супер-Админ
												</span>
											)}
										</div>
									</div>

									<div className='access-stats-grid'>
										<div className='access-stat-card'>
											<span>Итоговые права</span>
											<strong>
												{accessDetail.user.permissions?.length || 0}
											</strong>
										</div>

										<div className='access-stat-card'>
											<span>Обязательные</span>
											<strong>
												{accessDetail.user.locked_core_permissions?.length || 0}
											</strong>
										</div>

										<div className='access-stat-card'>
											<span>Индивидуальные</span>
											<strong>{overrideDraft.length}</strong>
										</div>

										<div className='access-stat-card'>
											<span>Data scope</span>
											<strong>
												{DATA_SCOPE_LABELS[accessDetail.user.data_scope] ||
													accessDetail.user.data_scope ||
													'—'}
											</strong>
										</div>
									</div>

									<div className='access-super-admin-row'>
										<div>
											<strong>Супер-Админ</strong>
											<p>
												Супер-Админ получает все активные permissions и не
												настраивается индивидуальными галочками.
											</p>
										</div>

										<button
											type='button'
											className={
												toBool(accessDetail.user.is_super_admin)
													? 'btn-danger-outline'
													: 'btn-save'
											}
											onClick={handleToggleSuperAdmin}
											disabled={
												accessSaving ||
												toBool(accessDetail.user.is_owner) ||
												Number(accessDetail.user.id) === currentUserId
											}
										>
											{toBool(accessDetail.user.is_super_admin)
												? 'Снять'
												: 'Выдать'}
										</button>
									</div>

									{toBool(accessDetail.user.is_owner) && (
										<div className='employee-readonly-note'>
											OWNER защищён: с владельца нельзя снять Супер-Админа и
											нельзя менять индивидуальные доступы.
										</div>
									)}

									{toBool(accessDetail.user.is_super_admin) &&
										!toBool(accessDetail.user.is_owner) && (
											<div className='employee-readonly-note'>
												У Супер-Админа индивидуальные доступы не редактируются,
												так как он получает все permissions.
											</div>
										)}

									<div className='access-checkbox-groups'>
										{Object.entries(groupedPermissionOptions).map(
											([category, items]) => (
												<div key={category} className='access-checkbox-group'>
													<div className='access-checkbox-group-title'>
														{CATEGORY_LABELS[category] || category}
													</div>

													<div className='access-checkbox-list'>
														{items.map(renderAccessRow)}
													</div>
												</div>
											),
										)}
									</div>
								</>
							) : (
								<div className='employees-empty'>Доступы не загружены</div>
							)}
						</div>

						<div className='employee-modal-actions'>
							<button
								className='btn-save'
								onClick={handleSaveOverrides}
								disabled={
									accessSaving ||
									!accessDetail?.user ||
									toBool(accessDetail?.user?.is_owner) ||
									toBool(accessDetail?.user?.is_super_admin)
								}
							>
								{accessSaving ? 'Сохранение...' : 'Сохранить доступы'}
							</button>

							<button className='btn-cancel' onClick={handleCloseAccess}>
								Закрыть
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
