const fs = require('fs');

const deps_idf = "75 77 78 91 92 93 94 95".split(' ')

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}
const remove_accents = (s) => (
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
)

const prepare_comparison = (s) => (
    remove_accents(s).toLowerCase()
        .replace(/['-]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/(.*) \((le|la|les)\)$/, '$2 $1')
        .replace('saint', 'st')
        .replace(/ et /, ' ')
)

const find_best_sub = (needle, l) => {
    const needle_ = prepare_comparison(needle)
    const l_ = l.map(prepare_comparison)
    let matches = []
    if (matches.length === 0) matches = l_.filter(s => s === needle_)
    if (matches.length === 0) matches = l_.filter(s => s.startsWith(needle_))
    if (matches.length === 0) matches = l_.filter(s => s.includes(needle_))
    if (matches.length === 0) matches = l_.filter(s => needle_.includes(s))
    return { match: matches.length === 1 && l[l_.indexOf(matches[0])], matches }
}

const collect_ecoles = () => {
    // https://data.education.gouv.fr/explore/dataset/fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre/download?format=json
    const raw_list = JSON.parse(fs.readFileSync('fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre.json', 'utf8'));

    const export_it = ({ fields }) => {
        const nature_uai = fields.nature_uai
        return fields.position && {
            id: fields.numero_uai,
            label: fields.appellation_officielle,
            city: fields.libelle_commune,
            dep: fields.code_departement,
            type: 100 <= nature_uai && nature_uai < 200 ? 'primaire' :
                  300 <= nature_uai && nature_uai < 380 ? 'secondaire' : null, // réf : http://infocentre.pleiade.education.fr/bcn/workspace/viewTable/n/N_NATURE_UAI
            x: fields.position[0],
            y: fields.position[1],
            cp: fields.code_postal_uai,
            d: {},
        }
    }
    return raw_list.map(export_it)
}

const collect_creches = () => {
    // http://data.caf.fr/dataset/6df7fc29-2031-4022-a557-3adeb19c744c/resource/57d4189e-0dc0-413a-b2f2-8a5432a7cf34/download/EAJE2017.geojson
    const raw_list = JSON.parse(fs.readFileSync('EAJE2017.geojson', 'utf8')).features

    const export_it = ({ properties, geometry }) => {
        properties.Adresse = properties.Adresse.replace(/\d{5}$/, '') // cleanup double postal code :-(
        const [_, cp, city] = properties.Adresse.match(/(?:.* |^)(\d{5}) (.+)$/i) || []
        if (!cp) {
            console.warn("ignoring creche with Adresse", properties.Adresse, "<")
        }
        return cp && {
            id: properties.FID,
            label: properties.Nomequ,
            city,
            dep: cp.replace(/(..).*/, "$1"),
            type: "crèche",
            x: geometry.coordinates[1],
            y: geometry.coordinates[0],
            cp: cp,
            d: {},
        }
    }
    return raw_list.map(export_it)
}

const normalize_city_names = (good, l) => {
    let cp2cities = {}
    let all_cities = {}
    for (const e of good) {
        if (!cp2cities[e.cp]) cp2cities[e.cp] = {}
        cp2cities[e.cp][e.city] = true
        all_cities[e.city] = true
    }

    let cp_city = {}
    for (const e of l) {
        const key = e.cp + ":" + e.city
        if (!cp_city[key]) cp_city[key] = []
        cp_city[key].push(e)
    }
    let cp_city_to_city = {}
    for (const key in cp_city) {
        const e = cp_city[key][0]
        const cities = Object.keys(cp2cities[e.cp] || {})
        let m = find_best_sub(e.city, cities, e)
        if (!m.match) {
            const { match } = find_best_sub(e.city, Object.keys(all_cities), e)
            if (match) {
                console.warn("found match ignoring CP", match, e.city)
                m.match = match
            }
        }
        if (!m.match) {
            if (m.matches.length === 0) console.warn("no match", e.city, cities, e)
            if (m.matches.length > 1) console.warn("too many matches", e.city, cities, e)            
            m.match = capitalizeFirstLetter(e.city.toLowerCase())
        }
        for (const e of cp_city[key]) {
            e.city = m.match
        }
    }
}

const filter_etablissements = l => l.filter(e => e && deps_idf.includes(e.dep))


const ecoles = filter_etablissements(collect_ecoles())
const creches = filter_etablissements(collect_creches())

normalize_city_names(ecoles, creches)

const l = [...ecoles, ...creches]

console.log(JSON.stringify(l));
