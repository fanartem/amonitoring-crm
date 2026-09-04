import React, { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router'

import { API_BASE_URL, getAuthHeaders } from '../../api'
import { applyPortalTheme } from '../../utils/portalTheme'

import PortalSidebar from './PortalSidebar'
import PortalHeader from './PortalHeader'
import PortalProfile from './PortalProfile'
import PortalRequests from './PortalRequests'
import PortalVehicles from './PortalVehicles'
import PortalSubclients from './PortalSubclients'
import ProtectedRoute from '../ProtectedRoute'
import AccessDenied from '../AccessDenied'

import { PortalNotificationsProvider } from './PortalNotificationsContext'

import {
	getStoredUser,
	isPortalBlockedByParent,
	isPortalReadOnly,
	resolveLandingRoute,
} from '../../utils/access'

// Оболочка клиентского кабинета.
//
// Маршруты сотрудников здесь не объявлены вовсе — это вторая линия защиты
// помимо бэкенда: прямой заход на /warehouse попадёт в '*' и вернётся
// в кабинет. Первая линия — require_employee_user на роутерах CRM.
//
// ProtectedRoute переиспользуется как есть: он опирается на canAccessRoute,
// а туда portal_* ключи добавлены на шаге 318.
//
// PortalNotificationsProvider оборачивает всё содержимое: опрос уведомлений
// один на кабинет, и всплывающие окна он рисует сам. Провайдер обязан быть
// внутри роутера — он умеет открывать заявку по клику.
//
// Оформление (логотип и цвет) грузится здесь одним запросом на весь
// кабинет. Переменные темы ставятся на КОРЕНЬ документа, а не на .portal-app:
// всплывающие уведомления и модальные окна рисуются выше по дереву, и на
// корне их достанет тоже. Снимаем при размонтировании — иначе после выхода
// из кабинета фирменный цвет остался бы висеть на странице входа.

const PortalLandingRedirect = () => (
	<Navigate to={resolveLandingRoute()} replace />
)

export default function PortalApp({ user }) {
	const currentUser = user || getStoredUser()

	const readOnly = isPortalReadOnly(currentUser)
	const blockedByParent = isPortalBlockedByParent(currentUser)

	const [branding, setBranding] = useState(null)

	useEffect(() => {
		let cancelled = false
		let removeTheme = () => {}

		const loadBranding = async () => {
			try {
				const res = await fetch(`${API_BASE_URL}/portal/branding`, {
					headers: getAuthHeaders(),
				})

				if (!res.ok) return

				const data = await res.json()

				if (cancelled) return

				setBranding(data)

				// Цвет может быть не задан при загруженном логотипе — тогда
				// шапка остаётся нашей, а логотип клиента уже стоит. Это
				// рабочее состояние, а не половинчатое.
				if (data?.is_enabled && data?.base_color) {
					removeTheme = applyPortalTheme(
						document.documentElement,
						data.base_color,
					)
				}
			} catch (err) {
				// Оформление — украшение. Сломать из-за него вход в кабинет
				// было бы обменом плохим в любую сторону.
				console.error('Не удалось загрузить оформление кабинета:', err)
			}
		}

		loadBranding()

		return () => {
			cancelled = true
			removeTheme()
		}
	}, [])

	const logoDataUrl = branding?.is_enabled ? branding.logo_data_url : null

	return (
		<PortalNotificationsProvider>
			<div className='crm-app portal-app'>
				<style>{`
					.portal-readonly-banner {
						margin: 14px 20px 0;
						padding: 11px 14px;
						border-radius: 8px;
						background: #fff4e5;
						border: 1px solid #f0d9b0;
						color: #8a5b00;
						font-size: 13px;
						line-height: 1.45;
					}
				`}</style>

				<PortalHeader user={currentUser} logoDataUrl={logoDataUrl} />

				{readOnly && (
					<div className='portal-readonly-banner'>
						{blockedByParent
							? 'Доступ ограничен: обслуживание приостановлено по головной организации. ' +
								'Заявки и машины можно просматривать, создавать новые — нельзя. ' +
								'Обратитесь к вашему менеджеру.'
							: 'Доступ ограничен: обслуживание приостановлено. ' +
								'Заявки и машины можно просматривать, создавать новые — нельзя. ' +
								'Обратитесь к вашему менеджеру.'}
					</div>
				)}

				<div className='body-row'>
					<PortalSidebar />

					<main className='main'>
						<section
							className='content-section active'
							style={{ display: 'block', overflowY: 'auto', width: '100%' }}
						>
							<Routes>
								<Route path='/' element={<PortalLandingRedirect />} />

								<Route path='/login' element={<PortalLandingRedirect />} />

								<Route path='/portal' element={<PortalLandingRedirect />} />

								<Route path='/access-denied' element={<AccessDenied />} />

								<Route
									path='/portal/requests'
									element={
										<ProtectedRoute routeKey='portal_requests'>
											<PortalRequests />
										</ProtectedRoute>
									}
								/>

								<Route
									path='/portal/vehicles'
									element={
										<ProtectedRoute routeKey='portal_vehicles'>
											<PortalVehicles />
										</ProtectedRoute>
									}
								/>

								<Route
									path='/portal/subclients'
									element={
										<ProtectedRoute routeKey='portal_subclients'>
											<PortalSubclients />
										</ProtectedRoute>
									}
								/>

								<Route
									path='/portal/profile'
									element={
										<ProtectedRoute routeKey='portal_profile'>
											<PortalProfile />
										</ProtectedRoute>
									}
								/>

								<Route path='*' element={<PortalLandingRedirect />} />
							</Routes>
						</section>
					</main>
				</div>
			</div>
		</PortalNotificationsProvider>
	)
}
