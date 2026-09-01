import React, { useEffect } from 'react'
import { Navigate } from 'react-router'
import { canAccessRoute, getStoredUser } from '../utils/access'
import { isTokenExpired, redirectToLogin } from '../api'

export default function ProtectedRoute({ routeKey, children }) {
	const token = localStorage.getItem('access_token')
	const isSessionExpired = !token || isTokenExpired(token)

	// Именно window.location, а не <Navigate>: клиентский переход на /login
	// попадёт в LandingRedirect, тот вернёт на защищённый маршрут,
	// и получится бесконечный круг. Нужна полная перезагрузка,
	// чтобы App пересчитал состояние авторизации.
	useEffect(() => {
		if (isSessionExpired) {
			redirectToLogin('session_expired')
		}
	}, [isSessionExpired])

	if (isSessionExpired) {
		return null
	}

	if (!canAccessRoute(routeKey, getStoredUser())) {
		return <Navigate to='/access-denied' replace />
	}

	return children
}
