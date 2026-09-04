import React, { useEffect, useRef, useState } from 'react'
import { API_BASE_URL, getAuthHeaders, getJsonAuthHeaders } from '../api'
import {
	canUploadPortalAttachments,
	getStoredUser,
	hasAnyPermission,
} from '../utils/access'
import '../styles/AttachmentsPanel.css'

const formatFileSize = bytes => {
	const size = Number(bytes || 0)

	if (size < 1024) return `${size} Б`
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`

	return `${(size / 1024 / 1024).toFixed(1)} МБ`
}

const formatDateTime = value => {
	if (!value) return '—'

	try {
		return new Date(value).toLocaleString('ru-RU', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		})
	} catch {
		return value
	}
}

const getEntityAttachmentPrefix = entityType => {
	const normalized = String(entityType || '').toUpperCase()

	if (normalized === 'CLIENT') return 'clients.attachments'
	if (normalized === 'REQUEST') return 'requests.attachments'

	return null
}

const getEntityAttachmentPermissions = (entityType, action) => {
	const prefix = getEntityAttachmentPrefix(entityType)

	if (!prefix) return []

	if (action === 'view') {
		return [`${prefix}.view`, `${prefix}.manage`]
	}

	if (action === 'upload') {
		return [`${prefix}.upload`, `${prefix}.manage`]
	}

	if (action === 'rename') {
		return [`${prefix}.rename`, `${prefix}.edit`, `${prefix}.manage`]
	}

	if (action === 'delete') {
		return [`${prefix}.delete`, `${prefix}.manage`]
	}

	return [`${prefix}.manage`]
}

// У клиентской учётной записи своя пара кодов — решение Р54(А).
// Списки не смешиваем: у сотрудника attachments.upload означает «файлы
// всех доступных карточек», у клиента — «файлы своих заявок».
// Те же ветки стоят в user_can_upload_attachment в attachments.py.
const canUploadAttachments = (user, entityType) =>
	isClientPortalUser(user)
		? canUploadPortalAttachments(user)
		: hasAnyPermission(user, [
				'attachments.upload',
				'attachments.manage',
				...getEntityAttachmentPermissions(entityType, 'upload'),
			])

// Переименование и удаление чужих файлов клиенту недоступны ни при каких
// правах: по решению Р55 он распоряжается только своим файлом и только
// 2 минуты. Само разрешение приходит с сервера в can_rename/can_delete,
// здесь — только общий признак «может ли распоряжаться файлами вообще»,
// от которого зависят подсказки в интерфейсе.
const canManageAttachments = (user, entityType) =>
	isClientPortalUser(user)
		? false
		: hasAnyPermission(user, [
				'attachments.manage',
				...getEntityAttachmentPermissions(entityType, 'rename'),
				...getEntityAttachmentPermissions(entityType, 'delete'),
			])

// Учётная запись клиентского портала. Поле user_kind появится в ответе
// логина на этапе 5, до тех пор проверка просто всегда даёт false —
// в CRM работают только сотрудники.
const isClientPortalUser = user =>
	String(user?.user_kind || '').toUpperCase() === 'CLIENT' ||
	String(user?.data_scope || '').toUpperCase() === 'CLIENT'

// Права на конкретный файл считает бэкенд в attach_attachment_permissions().
const canDownloadAttachment = attachment => Boolean(attachment?.can_download)
const canRenameAttachment = attachment => Boolean(attachment?.can_rename)
const canDeleteAttachment = attachment => Boolean(attachment?.can_delete)
const canMarkAttachmentInternal = attachment =>
	Boolean(attachment?.can_mark_internal)
const attachmentIsInternal = attachment => Boolean(attachment?.is_internal)

export default function AttachmentsPanel({
	entityType,
	entityId,
	// Пустая строка убирает собственный заголовок панели: в кабинете
	// клиента она вложена в секцию, у которой заголовок уже есть.
	title = 'Прикрепленные файлы',
}) {
	const fileInputRef = useRef(null)

	const [attachments, setAttachments] = useState([])
	const [loading, setLoading] = useState(false)
	const [uploading, setUploading] = useState(false)
	const [error, setError] = useState('')

	const [editingId, setEditingId] = useState(null)
	const [editingName, setEditingName] = useState('')

	// Режим загрузки. Сохраняется между файлами намеренно: когда монтажник
	// выкладывает пачку служебных фото, отмечать каждое отдельно неудобно.
	// Текущий режим всегда виден в подписи кнопки.
	const [uploadAsInternal, setUploadAsInternal] = useState(false)

	const [togglingInternalId, setTogglingInternalId] = useState(null)

	const [successNotice, setSuccessNotice] = useState('')
	const [isSuccessNoticeLeaving, setIsSuccessNoticeLeaving] = useState(false)

	const normalizedEntityType = String(entityType || '').toUpperCase()
	const user = getStoredUser()

	const canUploadCurrentEntity = canUploadAttachments(
		user,
		normalizedEntityType,
	)
	const canManageCurrentEntity = canManageAttachments(
		user,
		normalizedEntityType,
	)

	const isPortalUser = isClientPortalUser(user)

	// Галочка «внутренний файл» — инструмент сотрудника.
	const showInternalControls = canUploadCurrentEntity && !isPortalUser

	const seesOnlyOwnAttachments =
		!hasAnyPermission(user, ['attachments.view_all', 'attachments.manage']) &&
		hasAnyPermission(user, ['attachments.view_own'])

	const getAttachmentsDescription = () => {
		if (seesOnlyOwnAttachments) {
			return 'Вы видите только файлы, загруженные вами.'
		}

		if (isPortalUser) {
			return 'Документы по этому объекту, открытые вам менеджером.'
		}

		return 'Документы, фото, чеки и другие файлы по этому объекту. Файлы с пометкой «Внутренний» клиенту в портале не видны.'
	}

	const getEmptyText = () => {
		if (seesOnlyOwnAttachments) {
			return 'У вас пока нет загруженных файлов по этому объекту.'
		}

		if (isPortalUser) {
			return canUploadCurrentEntity
				? 'Файлов пока нет. Вы можете приложить свои — их увидит ваш менеджер.'
				: 'Файлов по этой заявке пока нет.'
		}

		return 'Файлы пока не прикреплены'
	}

	useEffect(() => {
		if (!normalizedEntityType || !entityId) return

		fetchAttachments()
	}, [normalizedEntityType, entityId])

	const fetchAttachments = async () => {
		setLoading(true)
		setError('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/attachments/entity/${normalizedEntityType}/${entityId}`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось загрузить файлы')
			}

			const data = await res.json()
			setAttachments(Array.isArray(data) ? data : [])
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	const handleFileSelect = async e => {
		const file = e.target.files[0]

		if (!file) return

		if (!canUploadCurrentEntity) {
			setError('Недостаточно прав для загрузки файла')
			e.target.value = ''
			return
		}

		const markAsInternal = showInternalControls && uploadAsInternal

		const formData = new FormData()
		formData.append('file', file)
		formData.append('is_internal', markAsInternal ? 'true' : 'false')

		setUploading(true)
		setError('')

		try {
			const res = await fetch(
				`${API_BASE_URL}/attachments/entity/${normalizedEntityType}/${entityId}`,
				{
					method: 'POST',
					headers: getAuthHeaders(),
					body: formData,
				},
			)

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось загрузить файл')
			}

			if (!canManageCurrentEntity) {
				showSuccessNotice(
					'Файл загружен. У вас есть 2 минуты, чтобы проверить файл. Потом нельзя будет удалить.',
				)
			}

			await fetchAttachments()
		} catch (err) {
			setError(err.message)
		} finally {
			setUploading(false)
			e.target.value = ''
		}
	}

	const showSuccessNotice = message => {
		setSuccessNotice(message)
		setIsSuccessNoticeLeaving(false)

		setTimeout(() => {
			setIsSuccessNoticeLeaving(true)
		}, 6500)

		setTimeout(() => {
			setSuccessNotice('')
			setIsSuccessNoticeLeaving(false)
		}, 7000)
	}

	const startEdit = attachment => {
		setEditingId(attachment.id)
		setEditingName(
			attachment.display_name || attachment.original_filename || '',
		)
		setError('')
	}

	const cancelEdit = () => {
		setEditingId(null)
		setEditingName('')
	}

	const saveEdit = async attachmentId => {
		const nextName = editingName.trim()

		if (!nextName) {
			setError('Название файла не может быть пустым')
			return
		}

		try {
			const res = await fetch(`${API_BASE_URL}/attachments/${attachmentId}`, {
				method: 'PATCH',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({
					display_name: nextName,
				}),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось переименовать файл')
			}

			setAttachments(prev =>
				prev.map(item =>
					item.id === attachmentId
						? {
								...item,
								display_name: nextName,
							}
						: item,
				),
			)

			cancelEdit()
		} catch (err) {
			setError(err.message)
		}
	}

	const toggleAttachmentInternal = async attachment => {
		const nextIsInternal = !attachmentIsInternal(attachment)
		const fileName = attachment.display_name || attachment.original_filename

		const confirmText = nextIsInternal
			? `Скрыть файл "${fileName}" от клиента? В личном кабинете он перестанет быть виден.`
			: `Открыть файл "${fileName}" клиенту? Он станет виден в личном кабинете.`

		if (!window.confirm(confirmText)) return

		setTogglingInternalId(attachment.id)
		setError('')

		try {
			const res = await fetch(`${API_BASE_URL}/attachments/${attachment.id}`, {
				method: 'PATCH',
				headers: getJsonAuthHeaders(),
				body: JSON.stringify({
					is_internal: nextIsInternal,
				}),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось изменить видимость файла')
			}

			setAttachments(prev =>
				prev.map(item =>
					item.id === attachment.id
						? {
								...item,
								is_internal: nextIsInternal,
							}
						: item,
				),
			)
		} catch (err) {
			setError(err.message)
		} finally {
			setTogglingInternalId(null)
		}
	}

	const deleteAttachment = async attachment => {
		if (
			!window.confirm(
				`Удалить файл "${attachment.display_name || attachment.original_filename}"?`,
			)
		) {
			return
		}

		try {
			const res = await fetch(`${API_BASE_URL}/attachments/${attachment.id}`, {
				method: 'DELETE',
				headers: getAuthHeaders(),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				throw new Error(data?.detail || 'Не удалось удалить файл')
			}

			setAttachments(prev => prev.filter(item => item.id !== attachment.id))
		} catch (err) {
			setError(err.message)
		}
	}

	const downloadAttachment = async attachment => {
		try {
			const res = await fetch(
				`${API_BASE_URL}/attachments/${attachment.id}/download`,
				{
					headers: getAuthHeaders(),
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)
				throw new Error(data?.detail || 'Не удалось скачать файл')
			}

			const blob = await res.blob()
			const url = window.URL.createObjectURL(blob)
			const link = document.createElement('a')

			link.href = url
			link.download = attachment.display_name || attachment.original_filename
			document.body.appendChild(link)
			link.click()
			document.body.removeChild(link)
			window.URL.revokeObjectURL(url)
		} catch (err) {
			setError(err.message)
		}
	}

	return (
		<div className='attachments-panel'>
			<style>{`
				.attachments-internal-toggle {
					display: inline-flex;
					align-items: center;
					gap: 6px;
					font-size: 12px;
					font-weight: 600;
					color: #7a5a00;
					background: #fff8e1;
					border: 1px solid #f2d98c;
					border-radius: 14px;
					padding: 4px 10px;
					cursor: pointer;
					user-select: none;
					white-space: nowrap;
				}

				.attachments-internal-toggle input {
					accent-color: #b47c00;
					cursor: pointer;
					margin: 0;
				}

				.attachments-upload-controls {
					display: flex;
					align-items: center;
					gap: 10px;
					flex-wrap: wrap;
					justify-content: flex-end;
				}

				.attachments-internal-badge {
					display: inline-block;
					margin-left: 8px;
					padding: 1px 8px;
					border-radius: 10px;
					font-size: 11px;
					font-weight: 700;
					background: #fff8e1;
					color: #7a5a00;
					border: 1px solid #f2d98c;
					vertical-align: middle;
					white-space: nowrap;
				}

				.attachments-item.is-internal {
					background: #fffdf5;
				}
			`}</style>

			<div className='attachments-panel-header'>
				<div>
					{title && <h3>{title}</h3>}
					<p>{getAttachmentsDescription()}</p>
				</div>

				{canUploadCurrentEntity && (
					<div className='attachments-upload-controls'>
						{showInternalControls && (
							<label
								className='attachments-internal-toggle'
								title='Внутренние файлы не видны клиенту в личном кабинете'
							>
								<input
									type='checkbox'
									checked={uploadAsInternal}
									onChange={e => setUploadAsInternal(e.target.checked)}
									disabled={uploading}
								/>
								Внутренний файл
							</label>
						)}

						<input
							ref={fileInputRef}
							type='file'
							style={{ display: 'none' }}
							onChange={handleFileSelect}
							accept='.jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt'
						/>

						<button
							type='button'
							className='attachments-add-btn'
							onClick={() => fileInputRef.current?.click()}
							disabled={uploading}
						>
							{uploading
								? 'Загрузка...'
								: showInternalControls && uploadAsInternal
									? '+ Добавить внутренний файл'
									: '+ Добавить файл'}
						</button>
					</div>
				)}
			</div>

			{error && <div className='attachments-error'>{error}</div>}

			{successNotice && (
				<div
					className={`attachments-success-notice ${
						isSuccessNoticeLeaving ? 'leaving' : ''
					}`}
				>
					{successNotice}
				</div>
			)}

			{loading ? (
				<div className='attachments-empty'>Загрузка файлов...</div>
			) : attachments.length === 0 ? (
				<div className='attachments-empty'>{getEmptyText()}</div>
			) : (
				<div className='attachments-list'>
					{attachments.map(file => (
						<div
							key={file.id}
							className={`attachments-item ${
								attachmentIsInternal(file) ? 'is-internal' : ''
							}`}
						>
							<div className='attachments-file-icon'>📎</div>

							<div className='attachments-file-main'>
								{editingId === file.id ? (
									<div className='attachments-edit-row'>
										<input
											className='attachments-edit-input'
											value={editingName}
											onChange={e => setEditingName(e.target.value)}
											autoFocus
										/>

										<button
											type='button'
											className='attachments-save-btn'
											onClick={() => saveEdit(file.id)}
										>
											Сохранить
										</button>

										<button
											type='button'
											className='attachments-cancel-btn'
											onClick={cancelEdit}
										>
											Отмена
										</button>
									</div>
								) : (
									<>
										<div className='attachments-file-title'>
											{file.display_name || file.original_filename}

											{attachmentIsInternal(file) && !isPortalUser && (
												<span
													className='attachments-internal-badge'
													title='Клиенту в личном кабинете этот файл не виден'
												>
													Внутренний
												</span>
											)}
										</div>

										<div className='attachments-file-meta'>
											<span>{formatFileSize(file.file_size)}</span>
											<span>•</span>
											<span>
												Загрузил:{' '}
												{file.uploaded_by_name ||
													`ID ${file.uploaded_by || '—'}`}
											</span>
											<span>•</span>
											<span>{formatDateTime(file.uploaded_at)}</span>
										</div>

										{file.original_filename &&
											file.original_filename !== file.display_name && (
												<div className='attachments-original-name'>
													Исходное имя: {file.original_filename}
												</div>
											)}
									</>
								)}
							</div>

							{editingId !== file.id && (
								<div className='attachments-actions'>
									{canDownloadAttachment(file) && (
										<button
											type='button'
											className='attachments-action-btn'
											onClick={() => downloadAttachment(file)}
											title='Скачать'
										>
											⬇
										</button>
									)}

									{canMarkAttachmentInternal(file) && (
										<button
											type='button'
											className='attachments-action-btn'
											onClick={() => toggleAttachmentInternal(file)}
											disabled={togglingInternalId === file.id}
											title={
												attachmentIsInternal(file)
													? 'Открыть файл клиенту'
													: 'Скрыть файл от клиента'
											}
										>
											{attachmentIsInternal(file) ? '🔒' : '👁'}
										</button>
									)}

									{canRenameAttachment(file) && (
										<button
											type='button'
											className='attachments-action-btn'
											onClick={() => startEdit(file)}
											title='Переименовать'
										>
											✎
										</button>
									)}

									{canDeleteAttachment(file) && (
										<button
											type='button'
											className='attachments-action-btn danger'
											onClick={() => deleteAttachment(file)}
											title='Удалить'
										>
											🗑
										</button>
									)}
								</div>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	)
}
