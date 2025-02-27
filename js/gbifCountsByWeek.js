import { getListSubTaxonKeysByFilter } from "./gbifOccFacetCounts.js";
import { getGbifTaxonFromKey, getGbifTaxonKeyFromName } from "./fetchGbifSpecies.js";
import './extendDate.js'; //import getWeek() and toUtc()
const facetQuery = '&facet=eventDate&facetLimit=1200000&limit=0';
var Storage = window.sessionStorage ? window.sessionStorage : false;
var vtGeo = ['gadmGid=USA.46_1','stateProvince=vermont&stateProvince=vermont (State)'];
var verbose = 0;
/*
Return an object having occurrence sums by week (and month) for a taxon in the requested geometry/geography:
{
    search: searchTerm, //the search term used, either scientificName=Turdus or taxonKey=12345
    taxonName: taxonName, //the taxonName requested, or empty if queried explicitly by taxonKey
    total: total, //total count of occurrences for all time, minus those without week or month info
    weekToday: tdWk, //1-based, numeric weekOfYear for today's date
    weekSum: wSum, //object with sums of occurrence counts by week, 1-based (1=first week, 53=last week): {...,'23':8, '24':25, '25':109, ...}
    monthSum: mSum, //object with sums of occurrence counts by month, 1-based (1=January, 12=December): {'1':2, ...,'5':239, '6':842, ..., '12':3}
    weekArr: wArr //array of 53 weekly occurrence counts for d3.js chart: [{count: wSum[week], week: week, month: month}]
}

Since 'In the State of Vermont' is represented in occurrence data differently for different datasets, 
in order to get all the data we must query by all the distinct ways they're stored. As of the writing
of this module, that means querying thrice, by 

    gadmGid=USA.46_1
    stateProvince=vermont
    stateProvince=vermont (State)

But the last two can be combined into one query because http converts those into an effective OR condition, and GBIF
handles it that way.

GBIF occurrence API counts by eventDate for Vermont example queries:
https://api.gbif.org/v1/occurrence/search?gadmGid=USA.46_1&scientificName=Danaus%20plexippus&facet=eventDate&facetLimit=1200000&limit=0
https://api.gbif.org/v1/occurrence/search?stateProvince=vermont&stateProvince=vermont (State)&hasCoordinate=false&scientificName=Danaus%20plexippus&facet=eventDate&facetLimit=1200000&limit=0
*/
//wrap retrieval of phenology in this async function to return a promise, which elsewhere waits for data
export async function getStoredPhenology(searchTerm, geoSearch) {
    let storeName = searchTerm;
    if (geoSearch) {storeName = storeName + JSON.stringify(geoSearch);}
    console.log(`gbifCountsByWeek.js=>getStoredPhenology=>storeName: ${storeName} | searchTerm: ${searchTerm} | geoSearch: ${geoSearch}`);
    let phenology = Storage ? Storage.getItem(storeName) : false;
    if (phenology && '{}' != phenology) {
        phenology = JSON.parse(Storage.getItem(storeName));
        console.log(`gbifCountsByWeek.js=>getStoredPhenology=>Storage.getItem(${storeName}) returned`, phenology);
        return phenology;//returning a JSON data object from async function wraps the object in a promise. the caller should await or .then() it.
    } else {
        phenology = await fetchAll(searchTerm, geoSearch);
        if (Storage) {Storage.setItem(storeName, JSON.stringify(phenology));}
        console.log(`gbifCountsByWeek.js=>getStoredPhenology=>fetchAll(${searchTerm}) returned`, phenology);
        return phenology;
    }
}
export async function gbifCountsByWeekByListTaxonKey(taxonKey, fileConfig) {
    let speciesFilter = fileConfig.dataConfig.speciesFilter;
    let geoSearchA = fileConfig.predicateToQueries(fileConfig.dataConfig.rootPredicate, true);
    let drillRanks = fileConfig.dataConfig.drillRanks;
    return await gbifCountsByWeekByListKeyByFilters(taxonKey, speciesFilter, geoSearchA, drillRanks);
}
export async function gbifCountsByWeekByListKeyByFilters(taxonKey, speciesFilter, geoSearchA, drillRanks=['GENUS', 'SPECIES']) {
    let self = await getGbifTaxonFromKey(taxonKey); //retrieve species info for species-list taxonKey - to get nubKey for below
    let srch = `taxonKey=${self.nubKey ? self.nubKey : taxonKey}`;
    let subs = {keys:[], names:[]};
    if (drillRanks.includes(self.rank)) { //only drill-down lower ranks
        subs = await getListSubTaxonKeysByFilter(speciesFilter, taxonKey); //get sub-nubKeys of species-list key
        for (const key of subs.keys) {
            srch += `&taxonKey=${key}`; //add sub-nubKeys to searchTerm to be used by fetchAll
        }
    }
    console.log(`gbifCountsByWeekByListKeyByFilters(${taxonKey}) | self-nubKey:`, self.nubKey, 'sub-nubKeys:', subs.keys, 'searchTerm:', srch);
    
    //let res = await fetchAll(srch, geoSearchA);
    let res = await getStoredPhenology(srch, geoSearchA);
    res.nubKey = self.nubKey;
    res.keys = subs.keys.push(self.nubKey); //add self nubKey to array of keys for species-list key
    res.names = subs.names;
    res.search = srch; //return our enhanced searchTerm for caller to use
    return res;
}
export async function gbifCountsByWeekByTaxonKey(taxonKey, geoSearch) {
    return await fetchAllByKey(taxonKey, geoSearch);
}
export async function gbifCountsByWeekByTaxonName(taxonName, geoSearch) {
    return await fetchAllByName(taxonName, geoSearch);
}
async function fetchAllByKey(taxonKey, geoSearch) {
    //return await fetchAll(`taxonKey=${taxonKey}`, geoSearch);
    return await getStoredPhenology(`taxonKey=${taxonKey}`, geoSearch);
}
async function fetchAllByName(taxonName, geoSearch) {
    //return await fetchAll(`scientificName=${taxonName}`, geoSearch);
    return await getStoredPhenology(`scientificName=${taxonName}`, geoSearch)
}
//function fetchAll(searchTerm, taxonName, geoSearch) {
async function fetchAll(searchTerm, geoSearch) {
    geoSearch = geoSearch.length ? geoSearch : vtGeo;
    console.log(`gbifCountsByWeek=>fetchAll | searchTerm`, searchTerm, `geoSearch`, geoSearch);
    //let trailing = 'facet=eventDate&facetLimit=1200000&limit=0';
    let uris = [];
    for (const geo of geoSearch) {
        let uri = encodeURI(`https://api.gbif.org/v1/occurrence/search?${geo}&${searchTerm}&${facetQuery}`);
        uris.push(uri);
    }
    console.log(`gbifCountsByWeek=>fetchAll | URIs`, uris);
    let all = Promise.all(uris.map(uri => fetch(uri)))
        .then(responses => {
            //console.log(`gbifCountsByWeek=>fetchAll(${searchTerm}) RAW RESULT:`, responses);
            //Convert each response to json object
            return Promise.all(responses.map(async res => {
                let json = await res.json();
                if (verbose) {console.log(`gbifCountsByWeek::fetchAll(${searchTerm}) JSON RESULT FOR URL:`, res.url, json);}
                return json;
            }));
        })
        .then(arrj => {
            //console.log(`gbifCountsByWeek::fetchAll(${searchTerm}) ALL JSON RESULT:`, arrj);
            let total = 0, dSum = {}, wSum = {}, mSum = {}, dMin = 366, dMax = 0;
            arrj.forEach(json => {
                //console.log('json', json);
                if (json.facets[0]) {
                    json.facets[0].counts.map(count => {
                        total += count.count; //only add counts for returned facets
                        let date = new Date(count.name.split('/')[0]).toUtc(); //for eventDate ranges, use the range-start
                        let mnth = date.getMonth()+1; //convert month to 1-based here
                        let week = date.getWeek()+1; //convert week to 1-based here
                        let doy = date.getDOY(); //getDOY is 1-based?
                        if (1==week && 0==date.getHours() && 0==date.getMinutes() && 0==date.getSeconds()) {
                            if (verbose) {console.log('NOT Adding to Sums by Week and removing', count.count, 'from total for:', searchTerm, date, week, mnth);}
                            total -= count.count; //don't include these in totals either
                        } else {
                            dSum[doy] = dSum[doy] ? dSum[doy] + count.count : count.count;
                            wSum[week] = wSum[week] ? wSum[week] + count.count : count.count;
                            mSum[mnth] = mSum[mnth] ? mSum[mnth] + count.count : count.count;
                            if (doy < dMin) dMin = doy;
                            if (doy > dMax) dMax = doy;
                        }
                    });
                } else {
                    if (verbose) {console.log(`gbifCountsByWeek::fetchAll NO Facets Returned`, json.facets);}
                }
            });
            let tday = new Date().toUtc(); //today's date shifted to UTC
            let tdWk = tday.getWeek()+1; // the week we're in today, 1-based
            let wArr = [];
            for (var i=1;i<54;i++) { //convert sparse object to complete array (for d3.js charts)
                wArr.push({count:wSum[i]?wSum[i]:0, week:i, month:weekToMonth(i)});
            }
            let dArr = [];
            for (var i=1;i<367;i++) { //convert sparse object to complete array (for d3.js charts)
                dArr.push({count:dSum[i]?dSum[i]:0, doy:i});
            }
            return {search:searchTerm, total:total, weekToday:tdWk, weekSum:wSum, monthSum:mSum, weekArr:wArr, doyArr:dArr, doyExt:{min:dMin,max:dMax}};
        })
        .catch(err => {
            console.error(`gbifCountsByWeek.js=>fetchAll`, err);
            //return Promise.reject(new Error(err)); //must return a promise-based value. this allows the caller to use .catch(err) to handle.
            throw err;
        })
    return await all; //this returns the promise.all, above, which is a single promise distilled from an array of promises.
}

function weekToMonth(weekNumber, year=2023) {
    // Create a date based on the first day of the given year
    const dateBeg = new Date(year, 0, 1);
    const dateEnd = new Date(year, 0, 1);
    
    // Adjust the date to the first day of the week
    dateBeg.setDate(dateBeg.getDate() + (weekNumber - 1) * 7 - dateBeg.getDay());

    // Get the month of the adjusted first day of week
    let begMon = dateBeg.getMonth() + 1; // Months are zero-indexed, so add 1
    
    // Adjust the date to the last day of the week
    dateEnd.setDate(dateEnd.getDate() + (weekNumber) * 7 - dateEnd.getDay());

    // Get the month of the adjusted last day of week
    let endMon = dateEnd.getMonth() + 1; // Months are zero-indexed, so add 1

    if (begMon == 12) {endMon=begMon;} //don't wrap month of year back to January for last week of December 

    let arrMon = begMon == endMon ? [begMon] : [begMon, endMon];

    //console.log('weekToMonth', arrMon);

    return arrMon;
}