export const toBool = value => value === true || value === 1 || value === '1'

export const getStoredUser = () => {
	try {
		return JSON.parse(localStorage.getItem('user_data') || 'null') || {}
	} catch {
		return {}
	}
}

export const isSuperAdmin = user => toBool(user?.is_super_admin)

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
	'warehouse.inventory.view_own',
]

const INVENTORY_FULL_VIEW_PERMISSIONS = [
	'warehouse.inventory.view_all',
	'warehouse.inventory.manage_all',
]

export const canAccessRoute = (routeKey, user = getStoredUser()) => {
	if (isSuperAdmin(user)) return true

	switch (routeKey) {
		case 'calendar':
			return (
				hasAnyPermission(user, [
					'calendar.view',
					'requests.view',
					'requests.view_all',
					'requests.view_own',
					'requests.view_assigned',
				]) ||
				hasLegacyRole(user, [
					'ADMIN',
					'ROP',
					'MANAGER',
					'TECH_SUPPORT',
					'ACCOUNTANT',
					'WAREHOUSE_MANAGER',
					'TECHNICIAN',
					'SENIOR_TECHNICIAN',
				])
			)

		case 'requests':
			return (
				hasAnyPermission(user, [
					'requests.view',
					'requests.view_all',
					'requests.view_own',
					'requests.view_assigned',
					'requests.create',
				]) ||
				hasLegacyRole(user, [
					'ADMIN',
					'ROP',
					'MANAGER',
					'TECH_SUPPORT',
					'ACCOUNTANT',
					'WAREHOUSE_MANAGER',
					'TECHNICIAN',
					'SENIOR_TECHNICIAN',
				])
			)

		case 'support_requests':
			return (
				hasAnyPermission(user, [
					'support_requests.view',
					'support_requests.create',
					'support_requests.manage',
				]) ||
				hasLegacyRole(user, [
					'ADMIN',
					'ROP',
					'MANAGER',
					'TECH_SUPPORT',
					'ACCOUNTANT',
					'WAREHOUSE_MANAGER',
				])
			)

		case 'clients':
			return (
				hasAnyPermission(user, [
					'clients.view',
					'clients.view_all',
					'clients.view_own',
					'clients.manage',
				]) ||
				hasLegacyRole(user, [
					'ADMIN',
					'ROP',
					'MANAGER',
					'TECH_SUPPORT',
					'ACCOUNTANT',
					'WAREHOUSE_MANAGER',
				])
			)

		case 'prices':
			return (
				hasAnyPermission(user, [
					'prices.view',
					'prices.manage',
					'base_prices.view',
					'client_prices.view',
				]) ||
				hasLegacyRole(user, [
					'ADMIN',
					'ROP',
					'MANAGER',
					'TECH_SUPPORT',
					'ACCOUNTANT',
				])
			)

		case 'employees':
			// Список сотрудников по твоему требованию видят все авторизованные.
			return true

		case 'approvals':
			return (
				hasAnyPermission(user, ['employees.approve', 'employees.manage']) ||
				hasLegacyRole(user, ['ADMIN', 'ROP'])
			)

		case 'warehouse':
			return (
				hasAnyPermission(user, [
					'warehouse.view',
					'warehouse.manage',
					'warehouse.items.view',
					'warehouse.items.manage',
				]) || hasLegacyRole(user, ['ADMIN', 'WAREHOUSE_MANAGER'])
			)

		case 'my_inventory':
			return hasAnyPermission(user, MY_INVENTORY_VIEW_PERMISSIONS)

		case 'inventory':
			return hasAnyPermission(user, INVENTORY_FULL_VIEW_PERMISSIONS)

		case 'trash':
			return (
				hasAnyPermission(user, [
					'trash.view',
					'trash.manage',
					'clients.restore',
					'vehicles.restore',
					'clients.delete',
					'vehicles.delete',
				]) || hasLegacyRole(user, ['ADMIN', 'ROP'])
			)

		case 'reports':
			return (
				hasAnyPermission(user, ['reports.view', 'reports.manage']) ||
				hasAnyPermission(user, [
					'prices.view',
					'prices.manage',
					'base_prices.view',
					'client_prices.view',
				]) ||
				hasLegacyRole(user, [
					'ADMIN',
					'ROP',
					'MANAGER',
					'TECH_SUPPORT',
					'ACCOUNTANT',
				])
			)

		case 'settings':
			return true

		default:
			return false
	}
}
