import React, { useRef } from 'react'
import { API_BASE_URL, getAuthHeaders } from '../api'
import '../styles/PendingAttachments.css'

/*
 * Файлы, выбранные ДО того, как сущность существует.
 *
 * AttachmentsPanel так не умеет и уметь не должен: он принимает
 * entityType + entityId и работает с сервером. При создании заявки
 * id появляется только после успешного POST /requests, поэтому файлы
 * сначала лежат в состоянии формы, а уходят на сервер следующим шагом.
 *
 * Компонент общий для CRM и кабинета клиента. Разница между ними —
 * только флаг allowInternal: пометить файл внутренним может сотрудник,
 * клиент — нет (сервер всё равно принудительно ставит is_internal = 0
 * для клиентских учёток, см. upload_attachment).
 */

// Зеркало серверных ограничений из attachments.py.
// Сервер остаётся источником правды: здесь мы лишь не даём человеку
// дойти до отказа, потратив время на загрузку 40 МБ.
export const ATTACHMENT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024

export const ATTACHMENT_ALLOWED_EXTENSIONS = [
	'.jpg',
	'.jpeg',
	'.png',
	'.webp',
	'.pdf',
	'.doc',
	'.docx',
	'.xls',
	'.xlsx',
	'.csv',
	'.txt',
]

export const ATTACHMENT_ACCEPT = ATTACHMENT_ALLOWED_EXTENSIONS.join(',')

// Ограничение только на пачку при создании. Оно нужно не серверу,
// а человеку: заявка создаётся одним запросом, а файлы уходят по одному,
// и полсотни файлов превращают создание заявки в минутное ожидание.
// Остальное прикрепляется в деталях заявки, где загрузка не блокирует форму.
export const PENDING_ATTACHMENTS_MAX_FILES = 10

let pendingAttachmentSequence = 0

export const formatAttachmentSize = bytes => {
	const size = Number(bytes || 0)

	if (size < 1024) return `${size} Б`
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`

	return `${(size / 1024 / 1024).toFixed(1)} МБ`
}

export const getAttachmentExtension = fileName => {
	const name = String(fileName || '')
	const dotIndex = name.lastIndexOf('.')

	if (dotIndex < 0) return ''

	return name.slice(dotIndex).toLowerCase()
}

/**
 * Причина, по которой файл нельзя прикрепить, или '' — если можно.
 */
export const getPendingAttachmentError = file => {
	if (!file) return 'Файл не выбран'

	const extension = getAttachmentExtension(file.name)

	if (!ATTACHMENT_ALLOWED_EXTENSIONS.includes(extension)) {
		return `«${file.name}»: формат ${extension || 'без расширения'} не поддерживается`
	}

	if (Number(file.size || 0) > ATTACHMENT_MAX_FILE_SIZE_BYTES) {
		return `«${file.name}»: ${formatAttachmentSize(file.size)} — больше 20 МБ`
	}

	if (Number(file.size || 0) === 0) {
		return `«${file.name}»: файл пустой`
	}

	return ''
}

export const createPendingAttachment = file => {
	pendingAttachmentSequence += 1

	return {
		local_id: `pending_${pendingAttachmentSequence}`,
		file,
		is_internal: false,
	}
}

/**
 * Загружает выбранные файлы к уже созданной сущности.
 *
 * Последовательно, а не Promise.all: при пачке файлов параллельные
 * запросы упираются в лимит соединений браузера, а порядок в списке
 * файлов заявки перестаёт совпадать с порядком выбора.
 *
 * Заявка на этот момент уже создана, поэтому ошибка одного файла не
 * должна ронять весь процесс: возвращаем оба списка, а решение —
 * повторить или закрыть — принимает вызывающая форма.
 */
export const uploadPendingAttachments = async (entityType, entityId, items) => {
	const uploaded = []
	const failed = []

	const normalizedEntityType = String(entityType || '').toUpperCase()
	const list = Array.isArray(items) ? items : []

	for (const item of list) {
		const file = item?.file

		if (!file) continue

		try {
			const formData = new FormData()

			formData.append('file', file)
			formData.append('is_internal', item.is_internal ? 'true' : 'false')

			const res = await fetch(
				`${API_BASE_URL}/attachments/entity/${normalizedEntityType}/${entityId}`,
				{
					method: 'POST',
					// Именно getAuthHeaders: Content-Type для multipart
					// проставляет браузер вместе с boundary. Указать его
					// руками — значит получить 400 на разборе тела.
					headers: getAuthHeaders(),
					body: formData,
				},
			)

			if (!res.ok) {
				const data = await res.json().catch(() => null)

				throw new Error(
					typeof data?.detail === 'string'
						? data.detail
						: 'Не удалось загрузить файл',
				)
			}

			uploaded.push(item)
		} catch (err) {
			failed.push({
				item,
				message: err?.message || 'Не удалось загрузить файл',
			})
		}
	}

	return { uploaded, failed }
}

export default function PendingAttachmentsPicker({
	items = [],
	onChange,
	disabled = false,
	allowInternal = false,
	maxFiles = PENDING_ATTACHMENTS_MAX_FILES,
	title = 'Файлы заявки',
	hint = 'Акт, доверенность, фото объекта. Файлы прикрепятся к заявке сразу после её создания.',
	error = '',
	onError,
}) {
	const inputRef = useRef(null)

	const reportError = message => {
		if (typeof onError === 'function') {
			onError(message)
		}
	}

	const handleFilesSelected = event => {
		const selected = Array.from(event.target.files || [])

		event.target.value = ''

		if (selected.length === 0) return

		const problems = []
		const accepted = []

		for (const file of selected) {
			const problem = getPendingAttachmentError(file)

			if (problem) {
				problems.push(problem)
				continue
			}

			// Один и тот же файл, выбранный дважды, — почти всегда промах,
			// а не намерение загрузить две копии.
			const isDuplicate = [...items, ...accepted].some(
				existing =>
					existing.file.name === file.name &&
					Number(existing.file.size) === Number(file.size),
			)

			if (isDuplicate) {
				problems.push(`«${file.name}» уже добавлен`)
				continue
			}

			accepted.push(createPendingAttachment(file))
		}

		const freeSlots = Math.max(0, maxFiles - items.length)
		const fitting = accepted.slice(0, freeSlots)

		if (accepted.length > fitting.length) {
			problems.push(
				`При создании можно прикрепить не больше ${maxFiles} файлов. ` +
					'Остальные добавьте в заявке после создания.',
			)
		}

		if (fitting.length > 0) {
			onChange?.([...items, ...fitting])
		}

		reportError(problems.join('\n'))
	}

	const removeItem = localId => {
		onChange?.(items.filter(item => item.local_id !== localId))
		reportError('')
	}

	const toggleInternal = localId => {
		onChange?.(
			items.map(item =>
				item.local_id === localId
					? { ...item, is_internal: !item.is_internal }
					: item,
			),
		)
	}

	const isFull = items.length >= maxFiles

	return (
		<div className='pending-attachments'>
			<div className='pending-attachments-header'>
				<div>
					{/* Заголовок необязателен: в модалке CRM он уже есть
					    у карточки, и второй выглядел бы дублем. */}
					{title && <div className='pending-attachments-title'>{title}</div>}
					<div className='pending-attachments-hint'>{hint}</div>
				</div>

				<input
					ref={inputRef}
					type='file'
					multiple
					style={{ display: 'none' }}
					accept={ATTACHMENT_ACCEPT}
					onChange={handleFilesSelected}
				/>

				<button
					type='button'
					className='pending-attachments-add-btn'
					onClick={() => inputRef.current?.click()}
					disabled={disabled || isFull}
					title={
						isFull
							? `Больше ${maxFiles} файлов при создании прикрепить нельзя`
							: 'Выбрать файлы'
					}
				>
					+ Добавить файлы
				</button>
			</div>

			{error && <div className='pending-attachments-error'>{error}</div>}

			{items.length === 0 ? (
				<div className='pending-attachments-empty'>
					Файлы не выбраны. До 20 МБ каждый: изображения, PDF, документы Word и
					Excel, CSV, TXT.
				</div>
			) : (
				<div className='pending-attachments-list'>
					{items.map(item => (
						<div
							key={item.local_id}
							className={`pending-attachments-item ${
								item.is_internal ? 'is-internal' : ''
							}`}
						>
							<div className='pending-attachments-file-icon'>📎</div>

							<div className='pending-attachments-file-main'>
								<div className='pending-attachments-file-name'>
									{item.file.name}
								</div>

								<div className='pending-attachments-file-meta'>
									{formatAttachmentSize(item.file.size)}
									{item.is_internal && (
										<span className='pending-attachments-internal-badge'>
											Внутренний
										</span>
									)}
								</div>
							</div>

							{allowInternal && (
								<label
									className='pending-attachments-internal-toggle'
									title='Внутренние файлы не видны клиенту в личном кабинете'
								>
									<input
										type='checkbox'
										checked={Boolean(item.is_internal)}
										onChange={() => toggleInternal(item.local_id)}
										disabled={disabled}
									/>
									Внутренний
								</label>
							)}

							<button
								type='button'
								className='pending-attachments-remove-btn'
								onClick={() => removeItem(item.local_id)}
								disabled={disabled}
								title='Убрать файл'
							>
								×
							</button>
						</div>
					))}
				</div>
			)}

			{items.length > 0 && (
				<div className='pending-attachments-counter'>
					Выбрано {items.length} из {maxFiles}
				</div>
			)}
		</div>
	)
}
