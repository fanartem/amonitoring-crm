export const toBool = value => value === true || value === 1 || value === '1'

export const getStoredUser = () => {
	try {
		return JSON.parse(localStorage.getItem('user_data') || 'null') || {}
	} catch {
		return {}
	}
}

// Используется при старте приложения: ответ /auth/me перезаписывает
// сохранённые данные, чтобы права не оставались замороженными до перелогина,
// а развилка «сотрудник / клиент» опиралась на сервер, а не на localStorage.
export const setStoredUser = user => {
	try {
		localStorage.setItem('user_data', JSON.stringify(user || {}))
	} catch {
		// Приватный режим или переполненное хранилище — не повод падать.
	}

	return user
}

export const isSuperAdmin = user => toBool(user?.is_super_admin)

export const isOwner = user => toBool(user?.is_owner)

export const hasPermission = (user, permissionCode) => {
	if (isSuperAdmin(user)) return true

	return (
		Array.isArray(user?.permissions) &&
		user.permissions.includes(permissionCode)
	)
}

export const hasAnyPermission = (user, permissionCodes = []) => {
	if (isSuperAdmin(user)) return true

	return permissionCodes.some(code => hasPermission(user, code))
}

export const getUserRole = user => user?.role || null

export const hasLegacyRole = (user, roles = []) => {
	const role = getUserRole(user)
	return role ? roles.includes(role) : false
}

// ---------------------------------------------------------------------------
// Тип учётной записи
//
// Повторяет permissions.py: is_client_user проверяет и тип, и область данных.
// Одного признака мало — если кто-то руками поменяет роль в Settings,
// второй признак поймает расхождение.
// ---------------------------------------------------------------------------

export const USER_KIND_EMPLOYEE = 'EMPLOYEE'
export const USER_KIND_CLIENT = 'CLIENT'

const CLIENT_DATA_SCOPE = 'CLIENT'
const CLIENT_PORTAL_ROLE = 'CLIENT_PORTAL'

export const getUserKind = user => {
	const kind = String(user?.user_kind || USER_KIND_EMPLOYEE)
		.trim()
		.toUpperCase()

	return kind === USER_KIND_CLIENT ? USER_KIND_CLIENT : USER_KIND_EMPLOYEE
}

export const isClientPortalUser = user => {
	if (!user) return false

	return (
		getUserKind(user) === USER_KIND_CLIENT ||
		String(user.data_scope || '')
			.trim()
			.toUpperCase() === CLIENT_DATA_SCOPE ||
		String(user.role || '')
			.trim()
			.toUpperCase() === CLIENT_PORTAL_ROLE
	)
}

export const isEmployeeUser = user => !isClientPortalUser(user)

export const getUserClientId = user => {
	if (!isClientPortalUser(user)) return null

	const clientId = user?.client_id

	return clientId ? Number(clientId) : null
}

export const getUserClientName = user =>
	isClientPortalUser(user) ? user?.client_name || null : null

// ---------------------------------------------------------------------------
// Права клиентского кабинета
//
// Повторяет can_access_portal / has_portal_permission из permissions.py:
// сначала тип учётки и привязка к клиенту, только потом само право.
// Сотрудник с ошибочно выданным portal.* в кабинет не попадёт.
// ---------------------------------------------------------------------------

export const canAccessPortal = user => {
	if (!isClientPortalUser(user)) return false
	if (!getUserClientId(user)) return false

	return hasAnyPermission(user, ['portal.access'])
}

const hasPortalPermission = (user, permissionCodes = []) =>
	canAccessPortal(user) && hasAnyPermission(user, permissionCodes)

export const canViewPortalRequests = user =>
	hasPortalPermission(user, ['portal.requests.view'])

export const canCreatePortalRequest = user =>
	hasPortalPermission(user, ['portal.requests.create'])

export const canCancelPortalRequest = user =>
	hasPortalPermission(user, ['portal.requests.cancel_new'])

export const canViewPortalVehicles = user =>
	hasPortalPermission(user, ['portal.vehicles.view'])

export const canViewPortalSubclients = user =>
	hasPortalPermission(user, ['portal.subclients.view'])

export const canCreatePortalSubclient = user =>
	hasPortalPermission(user, ['portal.subclients.create'])

export const canViewPortalPrices = user =>
	hasPortalPermission(user, ['portal.prices.view'])

export const canViewPortalInstallationSettings = user =>
	hasPortalPermission(user, ['portal.installation_settings.view'])

export const canChangeOwnPortalPassword = user =>
	hasPortalPermission(user, ['portal.password.change'])

export const canCreatePortalComment = user =>
	hasPortalPermission(user, ['portal.comments.create'])

// Клиент заблокирован сам или через родителя: кабинет работает на чтение.
// Значение считает бэкенд (get_portal_access_state) и отдаёт в /auth/login
// и /auth/me. Здесь это только подсказка для интерфейса — запрет на создание
// заявки в заблокированной ветке всё равно стоит на сервере.
export const isPortalReadOnly = user =>
	isClientPortalUser(user) && toBool(user?.portal_read_only)

export const isPortalBlockedByParent = user =>
	isClientPortalUser(user) && toBool(user?.portal_blocked_by_parent)

const MY_INVENTORY_VIEW_PERMISSIONS = ['warehouse.my_inventory.view']

// Совпадает с INVENTORY_FULL_READ_PERMISSION_CODES в warehouse.py.
// Скрытые алиасы warehouse.inventory.view / .manage сюда не входят
// намеренно: их нельзя снять галочкой в Settings, значит нельзя и давать
// по ним доступ.
const INVENTORY_FULL_VIEW_PERMISSIONS = [
	'warehouse.inventory.view_all',
	'warehouse.inventory.manage_all',
]

// Порядок = приоритет посадочной страницы после входа.
// Права не дублируем: источник правды — canAccessRoute.
const LANDING_ROUTES = [
	{ path: '/requests', routeKey: 'requests' },
	{ path: '/calendar', routeKey: 'calendar' },
	{ path: '/clients', routeKey: 'clients' },
	{ path: '/warehouse', routeKey: 'warehouse' },
	{ path: '/my-inventory', routeKey: 'my_inventory' },
	{ path: '/support-requests', routeKey: 'support_requests' },
	{ path: '/reports', routeKey: 'reports' },
]

// Посадочные страницы кабинета. Последняя — профиль: право
// portal.password.change обязательное (is_locked_core), поэтому
// клиент с доступом в кабинет никогда не окажется на /access-denied.
const PORTAL_LANDING_ROUTES = [
	{ path: '/portal/requests', routeKey: 'portal_requests' },
	{ path: '/portal/vehicles', routeKey: 'portal_vehicles' },
	{ path: '/portal/subclients', routeKey: 'portal_subclients' },
	{ path: '/portal/profile', routeKey: 'portal_profile' },
]

export const PORTAL_ROUTE_PREFIX = '/portal'

const PORTAL_ROUTE_KEY_PREFIX = 'portal_'

export const isPortalRouteKey = routeKey =>
	String(routeKey || '').startsWith(PORTAL_ROUTE_KEY_PREFIX)

export const resolveLandingRoute = (user = getStoredUser()) => {
	if (isClientPortalUser(user)) {
		const portalRoute = PORTAL_LANDING_ROUTES.find(item =>
			canAccessRoute(item.routeKey, user),
		)

		return portalRoute ? portalRoute.path : '/access-denied'
	}

	const route = LANDING_ROUTES.find(item => canAccessRoute(item.routeKey, user))

	return route ? route.path : '/access-denied'
}

const canAccessPortalRoute = (routeKey, user) => {
	switch (routeKey) {
		case 'portal_requests':
			return hasAnyPermission(user, ['portal.requests.view'])

		case 'portal_vehicles':
			return hasAnyPermission(user, ['portal.vehicles.view'])

		case 'portal_subclients':
			return hasAnyPermission(user, ['portal.subclients.view'])

		// Профиль и смена пароля. Право обязательное у роли портала,
		// снять его индивидуальным запретом нельзя — значит раздел есть
		// у любой учётной записи кабинета.
		case 'portal_profile':
			return true

		default:
			return false
	}
}

export const canAccessRoute = (routeKey, user = getStoredUser()) => {
	const portalRouteKey = isPortalRouteKey(routeKey)

	// Граница между кабинетом и CRM проверяется ДО супер-админа —
	// тот же порядок, что в users.py, где require_employee_user стоит
	// раньше is_super_admin. Иначе случайный флаг открыл бы клиенту
	// разделы сотрудников.
	if (isClientPortalUser(user)) {
		if (!portalRouteKey) return false
		if (!canAccessPortal(user)) return false

		return canAccessPortalRoute(routeKey, user)
	}

	// Сотруднику разделы кабинета недоступны в любом случае: portal.*
	// у него всё равно не сработает на бэкенде, а в интерфейсе выглядело бы
	// как настоящий доступ.
	if (portalRouteKey) return false

	if (isSuperAdmin(user)) return true

	switch (routeKey) {
		case 'calendar':
			return hasAnyPermission(user, ['calendar.view', 'requests.calendar.view'])

		case 'requests':
			return hasAnyPermission(user, [
				'requests.view',
				'requests.view_all',
				'requests.create',
			])

		case 'support_requests':
			return hasAnyPermission(user, ['support_requests.view'])

		case 'clients':
			return hasAnyPermission(user, [
				'clients.view',
				'clients.view_all',
				'clients.view_own',
			])

		case 'prices':
			return hasAnyPermission(user, [
				'prices.view',
				'prices.manage',
				'base_prices.view',
				'client_prices.view',
			])

		case 'employees':
			return hasAnyPermission(user, ['employees.view'])

		case 'approvals':
			return hasAnyPermission(user, ['employees.approve'])

		case 'warehouse':
			return hasAnyPermission(user, ['warehouse.view', 'warehouse.manage'])

		case 'my_inventory':
			return hasAnyPermission(user, MY_INVENTORY_VIEW_PERMISSIONS)

		case 'inventory':
			return hasAnyPermission(user, INVENTORY_FULL_VIEW_PERMISSIONS)

		case 'trash':
			return hasAnyPermission(user, [
				'requests.deleted.view',
				'clients.trash.view',
			])

		case 'reports':
			return hasAnyPermission(user, ['reports.view'])

		// Раздел открыт всем: внутри личные настройки сотрудника.
		// Административные вкладки закрыты внутри Settings.jsx
		// по settings.view / settings.manage — здесь их проверять не нужно.
		case 'settings':
			return true

		default:
			return false
	}
}

export const canViewPortalAttachments = user =>
	hasAnyPermission(user, ['portal.attachments.view'])

export const canUploadPortalAttachments = user =>
	hasAnyPermission(user, ['portal.attachments.upload'])