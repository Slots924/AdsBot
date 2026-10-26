import path from "node:path";

export default async function finalizeSetupMetadata({ result, profile, persona, photoSet, profileNo,
    adsPowerName, profileNameNote, skipNameChange, signal, updateName, markGender, renameFolder,
    adsPower, createStep, finalizeOutcome }) {
    if (result.nameChanged) {
        try {
            await updateName(profile.profile_id, adsPowerName);
            result.steps.adsPowerRename = createStep({
                ok: true,
                detail: adsPowerName,
            });
        } catch (error) {
            result.steps.adsPowerRename = createStep({
                error: error.message,
            });
        }
    } else if (skipNameChange) {
        result.steps.adsPowerRename = createStep({
            ok: true,
            skipped: true,
            reason: "Ім’я Facebook не змінювали",
        });
    }

    if (result.nameChanged || skipNameChange) {
        try {
            await markGender(adsPower, profile, persona.gender);
            result.steps.genderTag = createStep({
                ok: true,
                detail: persona.gender === "female" ? "Woman" : "Man",
            });
        } catch (error) {
            result.steps.genderTag = createStep({
                error: error.message,
            });
        }

        if (photoSet?.path) {
            try {
                const renamedPath = await renameFolder(
                    photoSet.path,
                    profileNo
                );
                result.renamedPhotoFolder = renamedPath;
                result.steps.photoFolderRename = createStep({
                    ok: true,
                    detail: `${path.basename(photoSet.path)} → ${
                        path.basename(renamedPath)
                    }`,
                    path: renamedPath,
                });
            } catch (error) {
                result.steps.photoFolderRename = createStep({
                    error: error.message,
                    path: photoSet.path,
                });
            }
        } else {
            result.steps.photoFolderRename = createStep({
                skipped: true,
                reason: "Немає папки фото",
            });
        }
    }

    finalizeOutcome();
    const note = String(profileNameNote ?? "").replace(/\s+/g, " ").trim();
    const canAppendNote = ["success", "completed_with_error"].includes(result.outcome)
        && result.steps.adsPowerRename.ok;
    if (canAppendNote && note && !signal?.aborted) {
        try {
            const currentName = skipNameChange ? profile.name : adsPowerName;
            if (!String(currentName ?? "").trim()) {
                throw new Error("Не вдалося визначити поточне ім’я AdsPower-профілю");
            }
            const nameWithNote = `${String(currentName).trim()} ${note}`;
            await updateName(profile.profile_id, nameWithNote);
            result.adsPowerName = nameWithNote;
            result.steps.adsPowerNote = createStep({ ok: true, detail: nameWithNote });
        } catch (error) {
            result.steps.adsPowerNote = createStep({ error: error.message });
        }
        finalizeOutcome();
    }
}
