import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { API_BASE_URL, getAuthHeaders } from '../../api'
import { canViewPortalVehicles, getStoredUser } from '../../utils/access'
import PortalCreateSubclientModal from './PortalCreateSubclientModal'
import { usePortalDataRevision } from './PortalNotificationsContext'

const MIN_SEARCH_LENGTH = 2
const SEARCH_DEBOUNCE_MS = 400

const formatDate = value => {
	if (!value) return '—'

	try {
		return new Date(value).toLocaleDateString('ru-RU')
	} catch {
		return '—'
	}
}

export default function PortalSubclients() {
	// Счётчики заявок и машин по организациям меняются вместе
	// с событиями по заявкам.
	const revision = usePortalDataRevision()

	const navigate = useNavigate()
	const currentUser = getStoredUser()
	const canOpenVehicles = canViewPortalVehicles(currentUser)

	const [items, setItems] = useState([])
	const [canCreate, setCanCreate] = useState(false)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')
	const [success, setSuccess] = useState('')

	const [searchInput, setSearchInput] = useState('')
	const [search, setSearch] = useState('')

	// Форма живёт в PortalCreateSubclientModal: ту же форму открывает
	// модалка создания заявки, и держать её в двух местах — значит
	// однажды поправить одно и забыть второе.
	const [isModalOpen, setModalOpen] = useState(false)

	useEffect(() => {
		const timeout = setTimeout(() => {
			const value = searchInput.trim()
			setSearch(value.length >= MIN_SEARCH_LENGTH ? value : '')
		}, SEARCH_DEBOUNCE_MS)

		return () => clearTimeout(timeout)
	}, [searchInput])

	useEffect(() => {
		fetchSubclients()
	}, [search, revision])

	const readError = async (res, fallback) => {
		const data = await res.json().catch(() => null)
		return data?.detail || fallback
	}

	const fetchSubclients = async () => {
		setLoading(true)
		setError('')

		try {
			const params = new URLSearchParams()

			if (search) params.set('q', search)

			const query = params.toString()

			const res = await fetch(
				`${API_BASE_URL}/portal/subclients${query ? `?${query}` : ''}`,
				{ headers: getAuthHeaders() },
			)

			if (!res.ok) {
				throw new Error(
					await readError(res, 'Не удалось загрузить организации'),
				)
			}

			const data = await res.json()

			setItems(Array.isArray(data.items) ? data.items : [])
			setCanCreate(Boolean(data.can_create))
		} catch (err) {
			setError(err.message)
			setItems([])
		} finally {
			setLoading(false)
		}
	}

	const handleCreated = async created => {
		setModalOpen(false)
		setError('')

		setSuccess(
			`«${created.name}» добавлена в вашу структуру. ` +
				'Теперь по ней можно создавать заявки.',
		)

		await fetchSubclients()
	}

	const openVehicles = subclient => {
		navigate('/portal/vehicles', {
			state: { portalClientId: subclient.id },
		})
	}

	const totalVehicles = useMemo(
		() => items.reduce((sum, item) => sum + Number(item.vehicle_count || 0), 0),
		[items],
	)

	return (
		<div className='portal-sub-page'>
			<style>{`
				.portal-sub-page {
					padding: 24px 20px 40px;
				}

				.portal-sub-page h2 {
					margin: 0 0 4px;
					font-size: 20px;
					color: #222;
				}

				.portal-sub-subtitle {
					font-size: 13px;
					color: #777;
					margin-bottom: 18px;
				}

				.portal-sub-toolbar {
					display: flex;
					gap: 10px;
					flex-wrap: wrap;
					align-items: center;
					margin-bottom: 16px;
				}

				.portal-sub-input {
					border: 1px solid #ddd;
					border-radius: 6px;
					padding: 8px 11px;
					font-size: 14px;
					box-sizing: border-box;
					background: #fff;
					width: 100%;
				}

				.portal-sub-search {
					min-width: 240px;
					flex: 1 1 240px;
					width: auto;
				}

				.portal-sub-btn {
					border: 1px solid #ddd;
					background: #fff;
					border-radius: 6px;
					padding: 8px 15px;
					font-size: 13px;
					color: #444;
					cursor: pointer;
					white-space: nowrap;
				}

				.portal-sub-btn.primary {
					background: var(--pb-primary, #5e9424);
					border-color: var(--pb-primary, #5e9424);
					color: var(--pb-on-primary, #fff);
					font-weight: 600;
				}

				.portal-sub-btn:disabled {
					opacity: 0.6;
					cursor: not-allowed;
				}

				.portal-sub-card {
					background: #fff;
					border: 1px solid #e6e6e6;
					border-radius: 10px;
					padding: 14px 16px;
					margin-bottom: 10px;
				}

				.portal-sub-card-top {
					display: flex;
					justify-content: space-between;
					gap: 12px;
					flex-wrap: wrap;
					align-items: baseline;
				}

				.portal-sub-name {
					font-size: 15px;
					font-weight: 700;
					color: #222;
				}

				.portal-sub-type {
					display: inline-block;
					margin-left: 8px;
					font-size: 11px;
					font-weight: 700;
					padding: 2px 8px;
					border-radius: 10px;
					background: #f2f4f6;
					color: #555;
					border: 1px solid #e2e6ea;
				}

				.portal-sub-counts {
					font-size: 13px;
					color: #555;
					white-space: nowrap;
				}

				.portal-sub-meta {
					font-size: 13px;
					color: #666;
					margin-top: 6px;
					line-height: 1.55;
				}

				.portal-sub-actions {
					display: flex;
					gap: 8px;
					flex-wrap: wrap;
					margin-top: 11px;
				}

				.portal-sub-banner {
					padding: 10px 12px;
					border-radius: 8px;
					font-size: 13px;
					line-height: 1.45;
					margin-bottom: 14px;
				}

				.portal-sub-banner.error {
					background: #fdecea;
					border: 1px solid #f5c6cb;
					color: #b71c1c;
				}

				.portal-sub-banner.success {
					background: #edf7e6;
					border: 1px solid #cfe6b8;
					color: #3f6b1a;
				}

				.portal-sub-banner.info {
					background: #f4f6f8;
					border: 1px solid #e0e4e8;
					color: #555;
				}

				.portal-sub-empty {
					padding: 30px 0;
					text-align: center;
					color: #888;
					font-size: 14px;
				}
			`}</style>

			<h2>Подклиенты</h2>
			<div className='portal-sub-subtitle'>
				Организации в вашей структуре. По каждой из них можно создавать заявки и
				вести автомобили.
			</div>

			{error && <div className='portal-sub-banner error'>{error}</div>}
			{success && <div className='portal-sub-banner success'>{success}</div>}

			<div className='portal-sub-toolbar'>
				<input
					className='portal-sub-input portal-sub-search'
					value={searchInput}
					onChange={e => setSearchInput(e.target.value)}
					placeholder='Название, БИН/ИИН, телефон...'
				/>

				{canCreate && (
					<button
						type='button'
						className='portal-sub-btn primary'
						onClick={() => {
							setSuccess('')
							setModalOpen(true)
						}}
					>
						+ Добавить организацию
					</button>
				)}
			</div>

			{loading ? (
				<div className='portal-sub-empty'>Загрузка организаций...</div>
			) : items.length === 0 ? (
				<div className='portal-sub-empty'>
					{search
						? 'По запросу ничего не найдено'
						: 'В вашей структуре пока нет организаций'}
				</div>
			) : (
				<>
					<div className='portal-sub-banner info'>
						Организаций: {items.length} · Автомобилей в структуре:{' '}
						{totalVehicles}
					</div>

					{items.map(subclient => (
						<div key={subclient.id} className='portal-sub-card'>
							<div className='portal-sub-card-top'>
								<div>
									<span className='portal-sub-name'>{subclient.name}</span>

									{subclient.type_label && (
										<span className='portal-sub-type'>
											{subclient.type_label}
										</span>
									)}
								</div>

								<div className='portal-sub-counts'>
									Авто: <b>{subclient.vehicle_count}</b> · Заявок:{' '}
									<b>{subclient.request_count}</b>
								</div>
							</div>

							<div className='portal-sub-meta'>
								{subclient.contact_name &&
								subclient.contact_name !== subclient.name
									? `${subclient.contact_name} · `
									: ''}
								{subclient.phone || 'телефон не указан'}
								{subclient.bin_iin ? ` · ${subclient.bin_iin}` : ''}
								{subclient.email ? ` · ${subclient.email}` : ''}
								<br />
								Добавлена: {formatDate(subclient.created_at)}
							</div>

							{canOpenVehicles && subclient.vehicle_count > 0 && (
								<div className='portal-sub-actions'>
									<button
										type='button'
										className='portal-sub-btn'
										onClick={() => openVehicles(subclient)}
									>
										Автомобили организации
									</button>
								</div>
							)}
						</div>
					))}
				</>
			)}

			{isModalOpen && (
				<PortalCreateSubclientModal
					onClose={() => setModalOpen(false)}
					onCreated={handleCreated}
				/>
			)}
		</div>
	)
}
