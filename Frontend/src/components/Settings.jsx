import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import {
	getStoredUser,
	hasAnyPermission,
	isSuperAdmin,
	toBool,
} from '../utils/access'
import '../styles/Settings.css'

const ADMIN_ONLY_NOTIFICATION_TYPES = ['REQUEST_TIME_CONFLICT']

const DEFAULT_ROLE_COLOR = '#64748B'

const DATA_SCOPE_FALLBACK = [
	{
		code: 'ALL',
		name: 'Все данные',
		description: 'Пользователь работает со всеми данными CRM',
	},
	{
		code: 'CITY',
		name: 'Только свой город',
		description: 'Пользователь работает только с данными своего города',
	},
	{
		code: 'RESPONSIBLE_CLIENTS',
		name: 'Свои клиенты',
		description:
			'Пользователь работает с клиентами, где он создатель или ответственный',
	},
	{
		code: 'ASSIGNED',
		name: 'Назначенное',
		description: 'Пользователь работает только с назначенными ему сущностями',
	},
	{
		code: 'CITY_ASSIGNED',
		name: 'Свой город и назначенное',
		description:
			'Для исполнителей: свой город, свободные/назначенные заявки и свои работы',
	},
	{
		code: 'OWN',
		name: 'Только своё',
		description: 'Пользователь работает только со своими сущностями',
	},
	{
		code: 'NONE',
		name: 'Без области данных',
		description: 'Нет автоматической области доступа к данным',
	},
]

const DATA_SCOPE_LABELS = DATA_SCOPE_FALLBACK.reduce((acc, item) => {
	acc[item.code] = item.name
	return acc
}, {})

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

const DEFAULT_ROLE_FORM = {
	code: '',
	name: '',
	description: '',
	badge_color: DEFAULT_ROLE_COLOR,
	data_scope: 'NONE',
	is_active: true,
	can_be_request_executor: false,
	can_be_responsible_manager: false,
	sort_order: 100,
	reason: '',
}

const normalizeRoleCode = value =>
	String(value || '')
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9_]/g, '')

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

const formatRoleDate = value => {
	if (!value) return '—'

	try {
		return new Date(value).toLocaleDateString('ru-RU')
	} catch {
		return '—'
	}
}

export default function Settings() {
	const [cities, setCities] = useState([])
	const [newCityName, setNewCityName] = useState('')
	const [editingCityId, setEditingCityId] = useState(null)
	const [editingCityName, setEditingCityName] = useState('')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')
	const [notificationSettings, setNotificationSettings] = useState([])
	const [notificationLoading, setNotificationLoading] = useState(false)
	const [notificationError, setNotificationError] = useState('')

	const [timeConflictCities, setTimeConflictCities] = useState([])
	const [timeConflictCitiesLoading, setTimeConflictCitiesLoading] =
		useState(false)
	const [timeConflictCitiesError, setTimeConflictCitiesError] = useState('')
	const [timeConflictCitiesSaving, setTimeConflictCitiesSaving] =
		useState(false)
	const [timeConflictCitiesSaved, setTimeConflictCitiesSaved] = useState('')

	const [roles, setRoles] = useState([])
	const [permissions, setPermissions] = useState([])
	const [dataScopes, setDataScopes] = useState(DATA_SCOPE_FALLBACK)
	const [rolesLoading, setRolesLoading] = useState(false)
	const [roleDetailLoading, setRoleDetailLoading] = useState(false)
	const [rolesError, setRolesError] = useState('')
	const [rolesSuccess, setRolesSuccess] = useState('')
	const [selectedRoleCode, setSelectedRoleCode] = useState('')
	const [selectedRole, setSelectedRole] = useState(null)
	const [roleForm, setRoleForm] = useState(DEFAULT_ROLE_FORM)
	const [rolePermissionCodes, setRolePermissionCodes] = useState(new Set())
	const [roleSaving, setRoleSaving] = useState(false)
	const [roleDeleting, setRoleDeleting] = useState(false)
	const [permissionSearch, setPermissionSearch] = useState('')

	const currentUser = getStoredUser()
	const userRole = currentUser.role || null

	const isAdmin = userRole === 'ADMIN'
	const isRop = userRole === 'ROP'
	const isWarehouseManager = userRole === 'WAREHOUSE_MANAGER'
	const canManageRoles = isSuperAdmin(currentUser)

	const canViewWarehouseNotifications =
		hasAnyPermission(currentUser, [
			'warehouse.view',
			'warehouse.manage',
			'warehouse.items.view',
			'warehouse.items.manage',
		]) ||
		isAdmin ||
		isWarehouseManager

	const canManageCities =
		hasAnyPermission(currentUser, [
			'settings.manage_cities',
			'settings.cities.manage',
			'settings.manage',
			'cities.manage',
			'cities.create',
			'cities.edit',
		]) ||
		isAdmin ||
		isRop

	const canManageTimeConflictCities =
		hasAnyPermission(currentUser, [
			'settings.manage_notifications',
			'settings.notifications.manage',
			'notifications.manage',
			'notifications.settings.manage',
			'notifications.request_time_conflict.manage',
			'settings.manage',
		]) || isAdmin

	const selectedRoleIsSystem = toBool(selectedRole?.is_system)
	const selectedRoleCanBeDeleted =
		selectedRole &&
		!selectedRoleIsSystem &&
		Number(selectedRole.users_count || 0) === 0

	const groupedRolePermissions = useMemo(() => {
		const search = permissionSearch.trim().toLowerCase()

		return permissions
			.filter(permission => {
				if (!search) return true

				const searchable = [
					permission.code,
					permission.name,
					permission.description,
					permission.category,
				]
					.filter(Boolean)
					.join(' ')
					.toLowerCase()

				return searchable.includes(search)
			})
			.reduce((acc, permission) => {
				const category = String(permission.category || 'general').toLowerCase()

				if (!acc[category]) acc[category] = []

				acc[category].push(permission)

				return acc
			}, {})
	}, [permissions, permissionSearch])

	useEffect(() => {
		fetchNotificationSettings()

		if (canManageCities) {
			fetchCities()
		}

		if (canManageTimeConflictCities) {
			fetchTimeConflictIgnoredCities()
		}

		if (canManageRoles) {
			fetchRoles()
			fetchPermissions()
			fetchDataScopes()
		}
	}, [canManageCities, canManageTimeConflictCities, canManageRoles])

	const fetchNotificationSettings = async () => {
		setNotificationLoading(true)
		setNotificationError('')

		try {
			const res = await fetch(`${API_BASE_URL}/notifications/settings`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(
					data?.detail || 'Не удалось загрузить настройки уведомлений',
				)
			}

			const data = await res.json()
			setNotificationSettings(Array.isArray(data) ? data : [])
		} catch (err) {
			setNotificationError(err.message)
		} finally {
			setNotificationLoading(false)
		}
	}

	const handleToggleNotification = async typeCode => {
		const nextSettings = notificationSettings.map(setting =>
			setting.type_code === typeCode
				? {
						...setting,
						is_enabled: !setting.is_enabled,
					}
				: setting,
		)

		setNotificationSettings(nextSettings)

		try {
			const changedSetting = nextSettings.find(
				setting => setting.type_code === typeCode,
			)

			const res = await fetch(`${API_BASE_URL}/notifications/settings`, {
				method: 'PATCH',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({
					settings: [
						{
							type_code: changedSetting.type_code,
							is_enabled: changedSetting.is_enabled,
						},
					],
				}),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(
					data?.detail || 'Не удалось обновить настройки уведомлений',
				)
			}
		} catch (err) {
			setNotificationError(err.message)
			fetchNotificationSettings()
		}
	}

	const fetchTimeConflictIgnoredCities = async () => {
		setTimeConflictCitiesLoading(true)
		setTimeConflictCitiesError('')
		setTimeConflictCitiesSaved('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/notifications/settings/request-time-conflict/ignored-cities`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(
					data?.detail ||
						'Не удалось загрузить города для уведомлений о пересечениях',
				)
			}

			const data = await res.json()
			setTimeConflictCities(Array.isArray(data) ? data : [])
		} catch (err) {
			setTimeConflictCitiesError(err.message)
		} finally {
			setTimeConflictCitiesLoading(false)
		}
	}

	const handleToggleTimeConflictCity = cityId => {
		setTimeConflictCitiesSaved('')

		setTimeConflictCities(prev =>
			prev.map(city =>
				city.city_id === cityId
					? {
							...city,
							is_ignored: !city.is_ignored,
						}
					: city,
			),
		)
	}

	const handleSaveTimeConflictCities = async () => {
		setTimeConflictCitiesSaving(true)
		setTimeConflictCitiesError('')
		setTimeConflictCitiesSaved('')

		const ignoredCityIds = timeConflictCities
			.filter(city => city.is_ignored)
			.map(city => city.city_id)

		try {
			const res = await fetch(
				`${API_BASE_URL}/notifications/settings/request-time-conflict/ignored-cities`,
				{
					method: 'PATCH',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({
						city_ids: ignoredCityIds,
					}),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(
					data?.detail ||
						'Не удалось сохранить города для уведомлений о пересечениях',
				)
			}

			setTimeConflictCitiesSaved('Настройки городов сохранены')
			fetchTimeConflictIgnoredCities()
		} catch (err) {
			setTimeConflictCitiesError(err.message)
		} finally {
			setTimeConflictCitiesSaving(false)
		}
	}

	const fetchCities = async () => {
		setLoading(true)
		setError('')

		try {
			const res = await fetch(`${API_BASE_URL}/cities?active_only=false`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить города')
			}

			const data = await res.json()
			setCities(Array.isArray(data) ? data : [])
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	const handleCreateCity = async e => {
		e.preventDefault()

		const name = newCityName.trim()

		if (!name) {
			setError('Введите название города')
			return
		}

		try {
			const res = await fetch(`${API_BASE_URL}/cities`, {
				method: 'POST',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({ name }),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось добавить город')
			}

			setNewCityName('')
			fetchCities()
		} catch (err) {
			setError(err.message)
		}
	}

	const startEditCity = city => {
		setEditingCityId(city.id)
		setEditingCityName(city.name)
		setError('')
	}

	const cancelEditCity = () => {
		setEditingCityId(null)
		setEditingCityName('')
	}

	const handleUpdateCity = async cityId => {
		const name = editingCityName.trim()

		if (!name) {
			setError('Название города не может быть пустым')
			return
		}

		try {
			const res = await fetch(`${API_BASE_URL}/cities/${cityId}`, {
				method: 'PATCH',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({ name }),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось обновить город')
			}

			cancelEditCity()
			fetchCities()
		} catch (err) {
			setError(err.message)
		}
	}

	const handleToggleCity = async city => {
		const nextActive = !city.is_active

		const confirmText = nextActive
			? `Включить город "${city.name}"?`
			: `Отключить город "${city.name}"? Он перестанет отображаться во всех формах выбора городов.`

		if (!window.confirm(confirmText)) return

		try {
			const res = await fetch(`${API_BASE_URL}/cities/${city.id}`, {
				method: 'PATCH',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({ is_active: nextActive }),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось изменить статус города')
			}

			fetchCities()
		} catch (err) {
			setError(err.message)
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

	const fetchDataScopes = async () => {
		try {
			const res = await fetch(`${API_BASE_URL}/access/data-scopes`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				setDataScopes(DATA_SCOPE_FALLBACK)
				return
			}

			const data = await res.json()
			setDataScopes(
				Array.isArray(data) && data.length > 0 ? data : DATA_SCOPE_FALLBACK,
			)
		} catch (err) {
			console.error('Ошибка загрузки data scopes:', err)
			setDataScopes(DATA_SCOPE_FALLBACK)
		}
	}

	const fetchRoles = async (preferredRoleCode = selectedRoleCode) => {
		setRolesLoading(true)
		setRolesError('')

		try {
			const res = await fetch(`${API_BASE_URL}/access/roles`, {
				headers: getAuthHeaders(),
			})

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить роли')
			}

			const data = await res.json()
			const list = Array.isArray(data) ? data : []
			setRoles(list)

			const normalizedPreferred = normalizeRoleCode(preferredRoleCode)
			const nextSelected =
				list.find(
					role => normalizeRoleCode(role.code) === normalizedPreferred,
				) || list[0]

			if (nextSelected && !selectedRole) {
				fetchRoleDetail(nextSelected.code)
			}
		} catch (err) {
			setRolesError(err.message)
		} finally {
			setRolesLoading(false)
		}
	}

	const fetchRoleDetail = async roleCode => {
		const normalizedCode = normalizeRoleCode(roleCode)

		if (!normalizedCode) return

		setRoleDetailLoading(true)
		setRolesError('')
		setRolesSuccess('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/access/roles/${normalizedCode}`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить роль')
			}

			const data = await res.json()
			const role = data.role

			setSelectedRoleCode(role.code)
			setSelectedRole(role)
			setRoleForm({
				code: role.code || '',
				name: role.name || '',
				description: role.description || '',
				badge_color: normalizeHexColor(role.badge_color),
				data_scope: role.data_scope || 'NONE',
				is_active: toBool(role.is_active),
				can_be_request_executor: toBool(role.can_be_request_executor),
				can_be_responsible_manager: toBool(role.can_be_responsible_manager),
				sort_order: Number(role.sort_order || 100),
				reason: '',
			})
			setRolePermissionCodes(
				new Set(
					Array.isArray(data.permissions)
						? data.permissions.map(permission => permission.code)
						: [],
				),
			)
		} catch (err) {
			setRolesError(err.message)
		} finally {
			setRoleDetailLoading(false)
		}
	}

	const startCreateRole = () => {
		setSelectedRoleCode('')
		setSelectedRole(null)
		setRoleForm(DEFAULT_ROLE_FORM)
		setRolePermissionCodes(new Set())
		setRolesError('')
		setRolesSuccess('')
	}

	const updateRoleForm = (field, value) => {
		setRoleForm(prev => ({ ...prev, [field]: value }))
	}

	const toggleRolePermission = permissionCode => {
		setRolePermissionCodes(prev => {
			const next = new Set(prev)

			if (next.has(permissionCode)) {
				next.delete(permissionCode)
			} else {
				next.add(permissionCode)
			}

			return next
		})
	}

	const buildRolePayload = () => ({
		code: normalizeRoleCode(roleForm.code),
		name: String(roleForm.name || '').trim(),
		description: roleForm.description || null,
		badge_color: normalizeHexColor(roleForm.badge_color),
		data_scope: String(roleForm.data_scope || 'NONE')
			.trim()
			.toUpperCase(),
		is_active: Boolean(roleForm.is_active),
		can_be_request_executor: Boolean(roleForm.can_be_request_executor),
		can_be_responsible_manager: Boolean(roleForm.can_be_responsible_manager),
		sort_order: Number(roleForm.sort_order || 100),
		reason: roleForm.reason || 'Изменение роли через Настройки',
	})

	const handleSaveRole = async e => {
		e.preventDefault()

		if (!canManageRoles) return

		const payload = buildRolePayload()

		if (!payload.code) {
			setRolesError('Укажите код роли')
			return
		}

		if (!payload.name) {
			setRolesError('Укажите название роли')
			return
		}

		setRoleSaving(true)
		setRolesError('')
		setRolesSuccess('')

		try {
			if (selectedRole) {
				const roleRes = await fetch(
					`${API_BASE_URL}/access/roles/${selectedRoleCode}`,
					{
						method: 'PATCH',
						headers: getJsonAuthHeaders(),
						body: JSON.stringify(payload),
					},
				)

				if (!roleRes.ok) {
					const data = await roleRes.json().catch(() => null)
					throw new Error(data?.detail || 'Не удалось обновить роль')
				}

				const permissionsRes = await fetch(
					`${API_BASE_URL}/access/roles/${selectedRoleCode}/permissions`,
					{
						method: 'PATCH',
						headers: getJsonAuthHeaders(),
						body: JSON.stringify({
							permission_codes: Array.from(rolePermissionCodes),
							reason: payload.reason,
						}),
					},
				)

				if (!permissionsRes.ok) {
					const data = await permissionsRes.json().catch(() => null)
					throw new Error(data?.detail || 'Не удалось обновить права роли')
				}

				setRolesSuccess('Роль обновлена')
				await fetchRoles(selectedRoleCode)
				await fetchRoleDetail(selectedRoleCode)
			} else {
				const res = await fetch(`${API_BASE_URL}/access/roles`, {
					method: 'POST',
					headers: getJsonAuthHeaders(),
					body: JSON.stringify({
						...payload,
						permission_codes: Array.from(rolePermissionCodes),
					}),
				})

				if (!res.ok) {
					const data = await res.json().catch(() => null)
					throw new Error(data?.detail || 'Не удалось создать роль')
				}

				setRolesSuccess('Роль создана')
				await fetchRoles(payload.code)
				await fetchRoleDetail(payload.code)
			}
		} catch (err) {
			setRolesError(err.message)
		} finally {
			setRoleSaving(false)
		}
	}

	const handleDeleteRole = async () => {
		if (!selectedRole || !selectedRoleCanBeDeleted) return

		if (!window.confirm(`Удалить роль "${selectedRole.name}"?`)) return

		setRoleDeleting(true)
		setRolesError('')
		setRolesSuccess('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/access/roles/${selectedRoleCode}`,
				{
					method: 'DELETE',
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось удалить роль')
			}

			setRolesSuccess('Роль удалена')
			setSelectedRole(null)
			setSelectedRoleCode('')
			setRoleForm(DEFAULT_ROLE_FORM)
			setRolePermissionCodes(new Set())
			await fetchRoles('')
		} catch (err) {
			setRolesError(err.message)
		} finally {
			setRoleDeleting(false)
		}
	}

	const visibleNotificationSettings = notificationSettings.filter(item => {
		if (ADMIN_ONLY_NOTIFICATION_TYPES.includes(item.type_code)) {
			return canManageTimeConflictCities
		}

		if (item.category === 'WAREHOUSE') {
			return canViewWarehouseNotifications
		}

		return true
	})

	const groupedNotificationSettings = visibleNotificationSettings.reduce(
		(acc, item) => {
			const category = item.category || 'GENERAL'

			if (!acc[category]) {
				acc[category] = []
			}

			acc[category].push(item)

			return acc
		},
		{},
	)

	const notificationCategoryLabels = {
		REQUESTS: 'Заявки',
		FINANCE: 'Финансы',
		WAREHOUSE: 'Склад',
		GENERAL: 'Общие',
	}

	return (
		<div className='settings-page'>
			<div className='settings-header'>
				<h2>Настройки</h2>
				<p>Управление системными параметрами CRM.</p>
			</div>

			{canManageRoles && (
				<div className='settings-card settings-roles-card'>
					<div className='settings-card-header settings-card-header-actions'>
						<div>
							<h3>Роли и доступы</h3>
							<p>
								Создание, редактирование и удаление ролей доступно только
								Супер-Админам.
							</p>
						</div>

						<button
							type='button'
							className='settings-primary-btn'
							onClick={startCreateRole}
						>
							+ Новая роль
						</button>
					</div>

					{rolesError && <div className='settings-error'>{rolesError}</div>}
					{rolesSuccess && (
						<div className='settings-success'>{rolesSuccess}</div>
					)}

					<div className='settings-roles-layout'>
						<div className='settings-roles-list'>
							<div className='settings-roles-list-title'>Роли</div>

							{rolesLoading && roles.length === 0 ? (
								<div className='settings-empty'>Загрузка ролей...</div>
							) : roles.length === 0 ? (
								<div className='settings-empty'>Роли не найдены</div>
							) : (
								roles.map(role => (
									<button
										key={role.code}
										type='button'
										className={`settings-role-item ${
											selectedRoleCode === role.code ? 'selected' : ''
										}`}
										onClick={() => fetchRoleDetail(role.code)}
										style={{
											'--role-color': normalizeHexColor(role.badge_color),
											'--role-bg': hexToRgba(role.badge_color, 0.14),
										}}
									>
										<span className='settings-role-item-main'>
											<span className='settings-role-name'>{role.name}</span>
											<span className='settings-role-code'>{role.code}</span>
										</span>

										<span className='settings-role-item-meta'>
											{toBool(role.is_system) && (
												<span className='settings-role-mini-tag'>system</span>
											)}
											{!toBool(role.is_active) && (
												<span className='settings-role-mini-tag muted'>
													off
												</span>
											)}
											<span>{Number(role.users_count || 0)} сотр.</span>
											<span>{Number(role.permissions_count || 0)} прав</span>
										</span>
									</button>
								))
							)}
						</div>

						<form className='settings-role-editor' onSubmit={handleSaveRole}>
							<div className='settings-role-editor-header'>
								<div>
									<h4>{selectedRole ? 'Редактирование роли' : 'Новая роль'}</h4>
									<p>
										{selectedRole
											? 'Измените данные роли и стандартный набор доступов.'
											: 'Создайте пользовательскую роль и выберите стартовые доступы.'}
									</p>
								</div>

								{selectedRole && (
									<span
										className='settings-role-badge'
										style={getRoleBadgeStyle(selectedRole)}
									>
										{selectedRole.name}
									</span>
								)}
							</div>

							{roleDetailLoading ? (
								<div className='settings-empty'>Загрузка роли...</div>
							) : (
								<>
									<div className='settings-role-form-grid'>
										<label>
											Код роли
											<input
												className='settings-input'
												value={roleForm.code}
												disabled={Boolean(selectedRole)}
												onChange={e =>
													updateRoleForm(
														'code',
														normalizeRoleCode(e.target.value),
													)
												}
												placeholder='CEO'
											/>
											<span className='settings-field-hint'>
												A-Z, 0-9 и подчёркивание.
											</span>
										</label>

										<label>
											Название
											<input
												className='settings-input'
												value={roleForm.name}
												onChange={e => updateRoleForm('name', e.target.value)}
												placeholder='Директор'
											/>
										</label>

										<label>
											Цвет бейджа
											<div className='settings-color-row'>
												<input
													type='color'
													value={normalizeHexColor(roleForm.badge_color)}
													onChange={e =>
														updateRoleForm('badge_color', e.target.value)
													}
												/>
												<input
													className='settings-input'
													value={roleForm.badge_color}
													onChange={e =>
														updateRoleForm('badge_color', e.target.value)
													}
													placeholder='#64748B'
												/>
											</div>
										</label>

										<label>
											Data scope
											<select
												className='settings-input'
												value={roleForm.data_scope}
												disabled={selectedRoleIsSystem}
												onChange={e =>
													updateRoleForm('data_scope', e.target.value)
												}
											>
												{dataScopes.map(scope => (
													<option key={scope.code} value={scope.code}>
														{scope.name ||
															DATA_SCOPE_LABELS[scope.code] ||
															scope.code}
													</option>
												))}
											</select>
										</label>

										<label className='settings-role-form-full'>
											Описание
											<textarea
												className='settings-input settings-textarea'
												value={roleForm.description || ''}
												onChange={e =>
													updateRoleForm('description', e.target.value)
												}
												placeholder='Для кого эта роль и какой у неё уровень доступа'
											/>
										</label>

										<label>
											Сортировка
											<input
												type='number'
												className='settings-input'
												value={roleForm.sort_order}
												onChange={e =>
													updateRoleForm('sort_order', e.target.value)
												}
											/>
										</label>

										<label className='settings-role-form-full'>
											Причина изменения
											<input
												className='settings-input'
												value={roleForm.reason || ''}
												onChange={e => updateRoleForm('reason', e.target.value)}
												placeholder='Например: новая должность / изменение доступа'
											/>
										</label>
									</div>

									<div className='settings-role-flags'>
										<label className='settings-role-flag'>
											<input
												type='checkbox'
												checked={Boolean(roleForm.is_active)}
												disabled={selectedRoleIsSystem}
												onChange={e =>
													updateRoleForm('is_active', e.target.checked)
												}
											/>
											<span>Роль активна</span>
										</label>

										<label className='settings-role-flag'>
											<input
												type='checkbox'
												checked={Boolean(roleForm.can_be_request_executor)}
												disabled={selectedRoleIsSystem}
												onChange={e =>
													updateRoleForm(
														'can_be_request_executor',
														e.target.checked,
													)
												}
											/>
											<span>Может быть исполнителем заявки</span>
										</label>

										<label className='settings-role-flag'>
											<input
												type='checkbox'
												checked={Boolean(roleForm.can_be_responsible_manager)}
												disabled={selectedRoleIsSystem}
												onChange={e =>
													updateRoleForm(
														'can_be_responsible_manager',
														e.target.checked,
													)
												}
											/>
											<span>Может быть ответственным менеджером</span>
										</label>
									</div>

									{selectedRoleIsSystem && (
										<div className='settings-role-note'>
											Это системная роль. Data scope, активность и role flags
											защищены от изменения, чтобы не сломать бизнес-логику.
										</div>
									)}

									<div className='settings-role-permissions-header'>
										<div>
											<h5>Стандартные доступы роли</h5>
											<p>
												Выбрано: {rolePermissionCodes.size}. При сохранении доступы будут автоматически применены сотрудникам с этой ролью.
											</p>
										</div>

										<input
											className='settings-input settings-permission-search'
											value={permissionSearch}
											onChange={e => setPermissionSearch(e.target.value)}
											placeholder='Поиск по доступам...'
										/>
									</div>

									<div className='settings-permission-groups'>
										{permissions.length === 0 ? (
											<div className='settings-empty'>
												Доступы не загружены
											</div>
										) : Object.keys(groupedRolePermissions).length === 0 ? (
											<div className='settings-empty'>Ничего не найдено</div>
										) : (
											Object.entries(groupedRolePermissions).map(
												([category, items]) => (
													<div
														key={category}
														className='settings-permission-group'
													>
														<div className='settings-permission-group-title'>
															{CATEGORY_LABELS[category] || category}
														</div>

														<div className='settings-permission-list'>
															{items.map(permission => {
																const checked = rolePermissionCodes.has(
																	permission.code,
																)
																const description =
																	permission.description || permission.code
																const showDescription =
																	description &&
																	description !== permission.name &&
																	description !== permission.code

																return (
																	<label
																		key={permission.code}
																		className={`settings-permission-row ${
																			checked ? 'checked' : ''
																		}`}
																		title={permission.code}
																	>
																		<input
																			type='checkbox'
																			checked={checked}
																			onChange={() =>
																				toggleRolePermission(permission.code)
																			}
																		/>

																		<span className='settings-permission-content'>
																			<span className='settings-permission-title'>
																				{permission.name || permission.code}
																			</span>

																			{showDescription && (
																				<span className='settings-permission-description'>
																					{description}
																				</span>
																			)}
																		</span>
																	</label>
																)
															})}
														</div>
													</div>
												),
											)
										)}
									</div>

									<div className='settings-role-actions'>
										<button
											type='submit'
											className='settings-primary-btn'
											disabled={roleSaving}
										>
											{roleSaving
												? 'Сохранение...'
												: selectedRole
													? 'Сохранить роль'
													: 'Создать роль'}
										</button>

										{selectedRole && (
											<button
												type='button'
												className='settings-delete-role-btn'
												onClick={handleDeleteRole}
												disabled={!selectedRoleCanBeDeleted || roleDeleting}
												title={
													selectedRoleCanBeDeleted
														? 'Удалить роль'
														: 'Нельзя удалить системную роль или роль с сотрудниками'
												}
											>
												{roleDeleting ? 'Удаление...' : 'Удалить роль'}
											</button>
										)}
									</div>
								</>
							)}
						</form>
					</div>
				</div>
			)}

			<div className='settings-card'>
				<div className='settings-card-header'>
					<div>
						<h3>Уведомления</h3>
						<p>Выберите, какие уведомления вы хотите получать в CRM.</p>
					</div>
				</div>

				{notificationError && (
					<div className='settings-error'>{notificationError}</div>
				)}

				{notificationLoading ? (
					<div className='settings-empty'>Загрузка уведомлений...</div>
				) : visibleNotificationSettings.length === 0 ? (
					<div className='settings-empty'>Настройки уведомлений не найдены</div>
				) : (
					<div className='settings-notifications-list'>
						{Object.entries(groupedNotificationSettings).map(
							([category, items]) => (
								<div key={category} className='settings-notification-group'>
									<div className='settings-notification-group-title'>
										{notificationCategoryLabels[category] || category}
									</div>

									{items.map(item => (
										<label
											key={item.type_code}
											className='settings-notification-row'
										>
											<div>
												<div className='settings-notification-name'>
													{item.name}
												</div>
												{item.description && (
													<div className='settings-notification-description'>
														{item.description}
													</div>
												)}
											</div>

											<input
												type='checkbox'
												checked={Boolean(item.is_enabled)}
												onChange={() =>
													handleToggleNotification(item.type_code)
												}
											/>
										</label>
									))}
								</div>
							),
						)}
					</div>
				)}

				{canManageTimeConflictCities && (
					<div className='settings-conflict-cities'>
						<div className='settings-conflict-cities-header'>
							<div>
								<h4>Города для уведомлений о пересечениях</h4>
								<p>
									Галочка означает, что уведомления по этому городу включены.
									Уберите города, от которых не хотите получать уведомления при
									пересечениях заявок.
								</p>
							</div>
						</div>

						{timeConflictCitiesError && (
							<div className='settings-error'>{timeConflictCitiesError}</div>
						)}

						{timeConflictCitiesSaved && (
							<div className='settings-success'>{timeConflictCitiesSaved}</div>
						)}

						{timeConflictCitiesLoading ? (
							<div className='settings-empty'>Загрузка городов...</div>
						) : timeConflictCities.length === 0 ? (
							<div className='settings-empty'>Активные города не найдены</div>
						) : (
							<>
								<div className='settings-city-checkbox-grid'>
									{timeConflictCities.map(city => (
										<label
											key={city.city_id}
											className={`settings-city-checkbox ${
												city.is_ignored ? 'ignored' : 'enabled'
											}`}
										>
											<input
												type='checkbox'
												checked={!Boolean(city.is_ignored)}
												onChange={() =>
													handleToggleTimeConflictCity(city.city_id)
												}
											/>

											<span>
												<span className='settings-city-checkbox-name'>
													{city.city_name}
												</span>
												<span className='settings-city-checkbox-hint'>
													{city.is_ignored
														? 'Уведомления отключены'
														: 'Уведомления включены'}
												</span>
											</span>
										</label>
									))}
								</div>

								<div className='settings-conflict-cities-footer'>
									<button
										type='button'
										className='settings-primary-btn'
										onClick={handleSaveTimeConflictCities}
										disabled={timeConflictCitiesSaving}
									>
										{timeConflictCitiesSaving
											? 'Сохранение...'
											: 'Сохранить города'}
									</button>
								</div>
							</>
						)}
					</div>
				)}
			</div>

			{canManageCities && (
				<div className='settings-card'>
					<div className='settings-card-header'>
						<div>
							<h3>Города</h3>
							<p>
								Список городов используется в заявках, сотрудниках и фильтрах.
							</p>
						</div>
					</div>

					{error && <div className='settings-error'>{error}</div>}

					<form className='settings-add-row' onSubmit={handleCreateCity}>
						<input
							type='text'
							value={newCityName}
							onChange={e => setNewCityName(e.target.value)}
							placeholder='Название города'
							className='settings-input'
						/>

						<button type='submit' className='settings-primary-btn'>
							+ Добавить город
						</button>
					</form>

					{loading ? (
						<div className='settings-empty'>Загрузка...</div>
					) : cities.length === 0 ? (
						<div className='settings-empty'>Города пока не добавлены</div>
					) : (
						<div className='settings-table-wrap'>
							<table className='settings-table'>
								<thead>
									<tr>
										<th>Город</th>
										<th>Статус</th>
										<th>Дата создания</th>
										<th style={{ textAlign: 'right' }}>Действия</th>
									</tr>
								</thead>

								<tbody>
									{cities.map(city => (
										<tr key={city.id}>
											<td>
												{editingCityId === city.id ? (
													<input
														className='settings-input settings-table-input'
														value={editingCityName}
														onChange={e => setEditingCityName(e.target.value)}
													/>
												) : (
													<strong>{city.name}</strong>
												)}
											</td>

											<td>
												<span
													className={`settings-status ${
														city.is_active ? 'active' : 'inactive'
													}`}
												>
													{city.is_active ? 'Активен' : 'Отключён'}
												</span>
											</td>

											<td>{formatRoleDate(city.created_at)}</td>

											<td>
												<div className='settings-actions'>
													{editingCityId === city.id ? (
														<>
															<button
																type='button'
																className='settings-save-btn'
																onClick={() => handleUpdateCity(city.id)}
															>
																Сохранить
															</button>

															<button
																type='button'
																className='settings-cancel-btn'
																onClick={cancelEditCity}
															>
																Отмена
															</button>
														</>
													) : (
														<>
															<button
																type='button'
																className='settings-edit-btn'
																onClick={() => startEditCity(city)}
															>
																Редактировать
															</button>

															<button
																type='button'
																className={
																	city.is_active
																		? 'settings-disable-btn'
																		: 'settings-enable-btn'
																}
																onClick={() => handleToggleCity(city)}
															>
																{city.is_active ? 'Отключить' : 'Включить'}
															</button>
														</>
													)}
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			)}
		</div>
	)
}
