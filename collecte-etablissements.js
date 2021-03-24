const _ = require('lodash')
const fs = require('fs');
const fetch = require('node-fetch')
const csvtojson = require('csvtojson')

const request_json = async (url, qs) => (
    (await fetch(url + '?' + new URLSearchParams(qs)) ).json()
)

const api_adresse_data_gouv_fr_geocode = async (e, adresse, citycode) => {
    if (citycode == 69383) {
        adresse = adresse.replace(/rue Rebatel$/i, 'Rue Docteur Rebatel')
    } else if (citycode == 69384) {
        adresse = adresse.replace(/rue H[eé]non$/i, 'rue Jacques-louis Hénon')
    }
    let qs = {
        q: adresse,
        type: "housenumber",
        lat: e.x,
        lon: e.y,
        limit: 1,
        // code postal est parfois un CEDEX? citycode plus fiable
        ...(citycode ? { citycode } : { postcode: e.cp }),
    }
    let r
    try {
        r = (await request_json('https://api-adresse.data.gouv.fr/search/', qs)).features[0]
    } catch (e) {
        console.error(e)
        return
    }
    if (r) {
        const precise = r.properties.score > 0.6
        console.error((precise ? "ok" : "bad"), "score:", r.properties.score, "distance:", r.properties.distance, "id:", e.id, "citycode:", citycode, "|", adresse, "==serait==>", r.properties.label)
        if (precise) {
            e.x = r.geometry.coordinates[1]
            e.y = r.geometry.coordinates[0]
            e.score = r.properties.score
        }
    } else {
        console.error("not found", "id:", e.id, "citycode:", citycode, "adresse:", adresse, "cp:", e.cp)
    }
}

const deps = "1 01 03 07 15 26 38 42 43 63 69 73 74".split(' ')
//const deps = "75 77 78 91 92 93 94 95".split(' ')
//  const deps = "69".split(' ')

const pmap = async (l, f) => {
    let r = []
    for (const e of l) {
        r.push(await f(e))
    }
    return r
}

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
        .replace(/^lyon 0+(\d+)/, 'lyon $1e')
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

const collect_ecoles = async (corrige) => {
    // https://data.education.gouv.fr/explore/dataset/fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre/download?format=json
    // https://data.education.gouv.fr/explore/dataset/fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre/download?format=json&timezone=Europe/Berlin&use_labels_for_header=false
    let raw_list = JSON.parse(fs.readFileSync('fr-en-adresse-et-geolocalisation-etablissements-premier-et-second-degre.json', 'utf8'));
    raw_list = raw_list.filter(e => e && e.fields && deps.includes(e.fields.code_departement))

    /*
    for (const e of raw_list) {
        const fields = e.fields
        console.log(fields.localisation, "|", fields.appariement)
    }
    return []
    */

   //raw_list = raw_list.filter(e => e.fields.adresse_uai && (e.fields.localisation !== 'Numéro de rue' || e.fields.appariement !== 'Parfaite') && (e.fields.libelle_commune || '').match(/lyon/i))
   //const slice = 70
   //raw_list = raw_list.slice(slice, slice + 1 )
   //console.log(raw_list)

    const export_it = async ({ fields }) => {
        const nature_uai = fields.nature_uai
        if (!fields.position) return
        let e = {
            id: fields.numero_uai,
            label: fields.appellation_officielle,
            city: fields.libelle_commune,
            dep: fields.code_departement,
            type: 100 <= nature_uai && nature_uai < 200 ? 'primaire' :
                  300 <= nature_uai && nature_uai < 380 ? 'secondaire' : null, // réf : http://infocentre.pleiade.education.fr/bcn/workspace/viewTable/n/N_NATURE_UAI
            x: fields.position[0],
            y: fields.position[1],
            cp: fields.code_postal_uai,
            //adresse: fields.adresse_uai,
            //localisation: fields.localisation,
            //appariement: fields.appariement,
            d: {},
        }
        if (corrige(e) && e.adresse || fields.adresse_uai && (fields.localisation !== 'Numéro de rue' || fields.appariement !== 'Parfaite') && fields.adresse_uai) {
            await api_adresse_data_gouv_fr_geocode(e, e.adresse || fields.adresse_uai, fields.code_commune)
        }
        return e
    }
    return pmap(raw_list, export_it)
}

const collect_creches = (corrige) => {
    // http://data.caf.fr/dataset/6df7fc29-2031-4022-a557-3adeb19c744c/resource/57d4189e-0dc0-413a-b2f2-8a5432a7cf34/download/EAJE2017.geojson
    const raw_list = JSON.parse(fs.readFileSync('EAJE2017.geojson', 'utf8')).features

    const export_it = async ({ properties, geometry }) => {
        properties.Adresse = properties.Adresse.replace(/\d{5}$/, '') // cleanup double postal code :-(
        let [_, cp, city] = properties.Adresse.match(/(?:.* |^)(\d{5}) (.+)$/i) || []
        if (!cp) {
            [_, cp, city] = properties.Adresse.match(/(?:.* |^)(\d{4}) (.+)$/i) || []
            if (cp) cp = "0" + cp
        }
        if (!cp) {
            console.warn("ignoring creche with Adresse", properties.Adresse, "<")
            return undefined
        }
        let e = {
            id: properties.FID,
            label: properties.Nomequ,
            city,
            dep: cp.replace(/(..).*/, "$1"),
            type: "crèche",
            x: geometry.coordinates[1],
            y: geometry.coordinates[0],
            //adresse: properties.Adresse,
            cp: cp,
            d: {},
        }
        if (corrige(e) && e.adresse) {
            await api_adresse_data_gouv_fr_geocode(e, e.adresse)
        }

    }
    return pmap(raw_list, export_it)
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

const corrections_manuelles = async () => {
    const l = await csvtojson().fromFile('aura/ecoles-corrections-manuelles.csv')
    const byids = _.keyBy(l.filter(e => e.appariement === 'need_update'), 'id')
    return (e) => {
        const e_ = byids[e.id]
        if (e_) {
            _.assign(e, _.pick(e_, 'adresse', 'label'))
        }
        return !!e_
    }
}

const filter_etablissements = l => l.filter(e => e && deps.includes(e.dep))

const doIt = async () => {
    let corrige = await corrections_manuelles()
    const ecoles = (await collect_ecoles(corrige)).filter(e => e)
    const creches = filter_etablissements(await collect_creches(corrige))

    normalize_city_names(ecoles, creches)

    const l = [...ecoles, ...creches]

    console.log(JSON.stringify(l));
}
doIt()
