export const API_BASE_URL =
	import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

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
