export const API_BASE_URL =
	import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export const clearAuthData = () => {
	localStorage.removeItem('access_token')
	localStorage.removeItem('user')
	localStorage.removeItem('user_data')
}

export const redirectToLogin = (reason = 'session_expired') => {
	clearAuthData()

	const currentPath = window.location.pathname
	const isEntrancePage =
		currentPath === '/' ||
		currentPath === '/login' ||
		currentPath === '/entrance'

	if (isEntrancePage) return

	window.location.href = `/?reason=${reason}`
}

const isAuthRequest = url => {
	const urlString = typeof url === 'string' ? url : url?.url || ''

	return (
		urlString.includes('/auth/login') || urlString.includes('/auth/register')
	)
}

const shouldHandleUnauthorized = (url, response) => {
	if (!response || response.status !== 401) return false
	if (isAuthRequest(url)) return false

	return true
}

export const installAuthInterceptor = () => {
	if (window.__amonitoringAuthInterceptorInstalled) return

	window.__amonitoringAuthInterceptorInstalled = true

	const originalFetch = window.fetch.bind(window)

	window.fetch = async (url, options = {}) => {
		const response = await originalFetch(url, options)

		if (shouldHandleUnauthorized(url, response)) {
			redirectToLogin('session_expired')
		}

		return response
	}
}

installAuthInterceptor()

export const getAuthHeaders = () => {
	const token = localStorage.getItem('access_token')

	return {
		Authorization: `Bearer ${token}`,
	}
}

export const getJsonAuthHeaders = () => {
	const token = localStorage.getItem('access_token')

	return {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${token}`,
	}
}

export const buildApiUrl = path => {
	const normalizedPath = path.startsWith('/') ? path : `/${path}`
	return `${API_BASE_URL}${normalizedPath}`
}
