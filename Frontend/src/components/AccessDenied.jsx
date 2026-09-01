import React from 'react'
import { Link } from 'react-router'
import { resolveLandingRoute } from '../utils/access'

export default function AccessDenied() {
	// Кнопка «назад» должна вести туда, куда человеку действительно можно,
	// иначе он вернётся на эту же страницу (см. шаг 167).
	const landingRoute = resolveLandingRoute()
	const hasSomewhereToGo = landingRoute !== '/access-denied'

	return (
		<div style={{ padding: '32px' }}>
			<div
				style={{
					maxWidth: '560px',
					background: '#fff',
					border: '1px solid #e5e7eb',
					borderRadius: '14px',
					padding: '24px',
					boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
				}}
			>
				<h2 style={{ margin: '0 0 10px', color: '#991b1b' }}>
					Недостаточно прав
				</h2>

				<p style={{ margin: '0 0 18px', color: '#64748b', lineHeight: 1.5 }}>
					{hasSomewhereToGo
						? 'У вашей роли нет доступа к этому разделу. Если доступ нужен по работе, обратитесь к администратору CRM.'
						: 'У вашей роли пока нет доступа ни к одному разделу. Обратитесь к администратору CRM — он настроит права.'}
				</p>

				{hasSomewhereToGo && (
					<Link
						to={landingRoute}
						style={{
							display: 'inline-flex',
							alignItems: 'center',
							padding: '10px 14px',
							borderRadius: '10px',
							background: '#5e9424',
							color: '#fff',
							textDecoration: 'none',
							fontWeight: 700,
						}}
					>
						Вернуться к доступным разделам
					</Link>
				)}
			</div>
		</div>
	)
}
