export const toBool = value => value === true || value === 1 || value === '1'

export const getStoredUser = () => {
	try {
		return JSON.parse(localStorage.getItem('user_data') || 'null') || {}
	} catch {
		return {}
	}
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

const MY_INVENTORY_VIEW_PERMISSIONS = [
	'warehouse.my_inventory.view',
]

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

export const resolveLandingRoute = (user = getStoredUser()) => {
	const route = LANDING_ROUTES.find(item => canAccessRoute(item.routeKey, user))

	return route ? route.path : '/access-denied'
}

export const canAccessRoute = (routeKey, user = getStoredUser()) => {
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
