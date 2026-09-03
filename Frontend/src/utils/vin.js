/**
 * Правила ввода VIN — одни на всё приложение.
 *
 * Живут отдельным модулем, потому что VIN вписывают из трёх мест:
 * окно завершения работ, редактирование машины в заявке и карточка
 * клиента. Три копии правила разойдутся при первой же правке.
 *
 * Почему проверка мягкая. По стандарту ISO 3779 VIN — ровно 17 символов
 * без букв I, O и Q (их исключили, чтобы не путать с 1 и 0). Но у
 * спецтехники вместо VIN часто номер рамы, и он бывает любой длины.
 * Жёсткое требование 17 знаков закрыло бы таким машинам завершение
 * работ навсегда, поэтому длина проверяется только по нижней границе,
 * а несоответствие стандарту показывается подсказкой, а не запретом.
 */

export const VIN_MIN_LENGTH = 5
export const VIN_MAX_LENGTH = 25
export const VIN_STANDARD_LENGTH = 17

// Буквы, которых в настоящем VIN не бывает.
const VIN_FORBIDDEN_LETTERS = /[IOQ]/

/**
 * Приводит ввод к виду, пригодному для базы: верхний регистр, только
 * латиница и цифры. Пробелы, дефисы и случайную кириллицу убираем сразу —
 * VIN часто копируют из писем и таблиц вместе с мусором.
 */
export const normalizeVin = value =>
	String(value || '')
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '')
		.slice(0, VIN_MAX_LENGTH)

/**
 * Ошибка, которая блокирует сохранение. Пустая строка — можно сохранять.
 */
export const getVinError = value => {
	const vin = normalizeVin(value)

	if (!vin) return 'Укажите VIN'

	if (vin.length < VIN_MIN_LENGTH) {
		return `Слишком короткий VIN — не меньше ${VIN_MIN_LENGTH} символов`
	}

	return ''
}

export const isValidVin = value => !getVinError(value)

/**
 * Подсказка, которая НЕ блокирует сохранение.
 *
 * Ловит две самые частые опечатки при переписывании со стекла:
 * недобранную длину и буквы I / O / Q вместо единицы и нуля.
 */
export const getVinWarning = value => {
	const vin = normalizeVin(value)

	if (!vin || getVinError(vin)) return ''

	if (VIN_FORBIDDEN_LETTERS.test(vin)) {
		return 'В VIN не бывает букв I, O и Q — проверьте, не 1 и 0 ли это'
	}

	if (vin.length !== VIN_STANDARD_LENGTH) {
		return `Обычно в VIN ${VIN_STANDARD_LENGTH} символов. Для спецтехники это нормально`
	}

	return ''
}
