import React from 'react'
import { Navigate } from 'react-router'
import { canAccessRoute, getStoredUser } from '../utils/access'

const isTokenExpired = token => {
	if (!token) return true

	try {
		const payload = JSON.parse(atob(token.split('.')[1]))
		if (!payload.exp) return false

		return payload.exp * 1000 < Date.now()
	} catch {
		return true
	}
}

export default function ProtectedRoute({ routeKey, children }) {
	const token = localStorage.getItem('access_token')

	if (!token || isTokenExpired(token)) {
		localStorage.removeItem('access_token')
		localStorage.removeItem('user_data')

		return <Navigate to='/login?reason=session_expired' replace />
	}

	const user = getStoredUser()

	if (!canAccessRoute(routeKey, user)) {
		return <Navigate to='/access-denied' replace />
	}

	return children
}
