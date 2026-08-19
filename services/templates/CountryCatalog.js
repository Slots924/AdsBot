import { readFile } from "node:fs/promises";


export default class CountryCatalog {
    constructor({ countriesFile = "./data/countries.json" } = {}) {
        this.countriesFile = countriesFile;
    }


    async list() {
        const parsed = JSON.parse(await readFile(this.countriesFile, "utf8"));
        return Object.entries(parsed)
            .map(([code, name]) => ({
                code: String(code).toUpperCase(),
                name: String(name),
                aliases: String(code).toUpperCase() === "GB" ? ["UK"] : [],
            }))
            .sort((left, right) => left.name.localeCompare(
                right.name,
                "en",
                { sensitivity: "base" }
            ));
    }
}
