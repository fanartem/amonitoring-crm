export const API_BASE_URL =
	import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export const clearAuthData = () => {
	localStorage.removeItem('access_token')
	localStorage.removeItem('user')
	localStorage.removeItem('user_data')

	// Плашка о созданной заявке лежит в sessionStorage вкладки и иначе
	// достанется следующему вошедшему в этой же вкладке (шаг 165).
	// Ключ продублирован из NewRequestNotice.jsx намеренно: api.js
	// не должен зависеть от компонентов.
	try {
		sessionStorage.removeItem('crm_new_request_notice')
		// В фильтрах заявок лежит поисковая строка — ФИО, телефон, гос. номер.
		sessionStorage.removeItem('requests_filters_state')
	} catch {
		// ignore
	}
}

let isRedirectingToLogin = false

export const redirectToLogin = (reason = 'session_expired') => {
	if (isRedirectingToLogin) return

	clearAuthData()

	const currentPath = window.location.pathname
	const isEntrancePage =
		currentPath === '/' ||
		currentPath === '/login' ||
		currentPath === '/entrance'

	if (isEntrancePage) return

	// Параллельные запросы дают несколько 401 подряд — без флага
	// каждый из них назначал бы window.location.href заново.
	isRedirectingToLogin = true

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

// Единственная копия разбора токена на весь фронт.
// Раньше их было две, и они расходились на токене без exp.
export const isTokenExpired = token => {
	try {
		if (!token) return true

		const payloadPart = String(token).split('.')[1]

		if (!payloadPart) return true

		// JWT кодируется в base64url: '-' и '_' вместо '+' и '/', без '=' в конце.
		// atob такого не понимает и бросает исключение.
		const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
		const paddingLength = (4 - (base64.length % 4)) % 4
		const payload = JSON.parse(atob(base64 + '='.repeat(paddingLength)))

		if (!payload.exp) return true

		return Number(payload.exp) * 1000 < Date.now()
	} catch {
		return true
	}
}

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
