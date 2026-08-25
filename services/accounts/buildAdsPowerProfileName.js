export default function buildAdsPowerProfileName({
    gender,
    firstName,
    lastName,
} = {}) {
    const prefix = gender === "female" ? "f_" : "m_";
    const fullName = [firstName, lastName]
        .map((part) => String(part ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" ");
    const name = `${prefix}${fullName}`.trim();

    if (name === prefix) {
        throw new Error("Ім’я AdsPower-профілю не може бути порожнім");
    }

    if (name.length > 100) {
        return name.slice(0, 100).trim();
    }

    return name;
}
