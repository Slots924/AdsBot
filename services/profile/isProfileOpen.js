export default async function isProfileOpen(
    adsPower,
    profile
) {
    try {
        if (!adsPower?.getCloudProfileStatus) {
            throw new Error(
                "Не передано екземпляр AdsPower"
            );
        }

        if (!profile?.profile_id) {
            throw new Error(
                "У профілю відсутній profile_id"
            );
        }

        const activeProfiles =
            await adsPower.getCloudProfileStatus(
                profile.profile_id
            );

        if (!Array.isArray(activeProfiles)) {
            throw new Error(
                "Отримано некоректний статус профілю"
            );
        }

        return activeProfiles.length > 0;

    } catch (error) {
        const profileNo = profile?.profile_no ?? "невідомий";

        console.error(
            `Не вдалося перевірити, чи відкритий профіль ${profileNo}:`,
            error.message
        );

        // За будь-якої помилки блокуємо повторний запуск профілю
        return true;
    }
}
