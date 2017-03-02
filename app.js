#!/usr/bin/env node

const https = require('https')
const http	= require('http')
const url		= require('url')
const path	= require("path")
const fs		= require("fs")
const async = require("async")

const mkdirp = (fullPath) => {
	path.dirname(fullPath).split(path.sep).reduce((current, folder) => {
		current += folder + path.sep;
		if (!fs.existsSync(current)){
			fs.mkdirSync(current);
		}
		return current;
	}, '');
}
const generateQueryString = (subRedit, query, limit, sort, after) => {
	return `/r/${subRedit}/${sort}/.json?limit=${limit}&after=${after}`
}

const downloadToFile = (where, link, callback) => { 
	const req = link.startsWith("https") ? https : http
	const parsed = url.parse(link)

	const fileName = path.join(where, path.basename(parsed.pathname))
	fs.access(fileName, fs.constants.F_OK, (err) => {
		if (err) {
			mkdirp(fileName)
			const file = fs.createWriteStream(fileName)
			console.log(`downloading ${link}`)
			req.get(
				link,
				response => {
					response.pipe(file)
					response.on("end", callback)
				}
			).on("error", function(e) {
				console.error(`failed to download ${link}`)
				callback()
			})
		} else {
			callback()
		}
	})
}

const getJSON = (url, path, callback) => {
	https.get({
			host:url,
			path:path
		}, 
		function(response) {
			let body = '';
			response.on('data', function(d) {
					body += d;
			});
			response.on('end', function() {
				let json 
				try {
					json = JSON.parse(body)
				} catch(e) {
					console.error(e);
				}
				callback(json)
			})
		}
	).on("error", (e) => getJSON(url, path, callback))
}

const getImageLinks = (subRedit, query, limit, sort, callback) => {
	let count = 0
	let results = []

	let launchQuery = (after) => {
		const queryPath = generateQueryString(subRedit, query, limit, sort, after)
		console.log(`launching query ${queryPath}`)
		getJSON(
			"www.reddit.com", 
			queryPath,
			(json) => {
				if (json && json.data && Array.isArray(json.data.children)) {
					const urls = json.data.children.map(
						child => (child.data && child.data.url) ? child.data.url : undefined
					).filter(
						url => url != undefined && (
							url.endsWith('jpg') || url.endsWith('jpeg') || url.endsWith('png')
						) 
					)
					results = results.concat(urls)
					console.log(`--> returned ${urls.length}`)
					if ((results.length < limit) && json.data.after) {
						launchQuery(json.data.after)
						return
					}
				}	
				callback(results)		
			}
		)
	}
	launchQuery("")
}

let configuration


try {
	configuration = require(
		`./${path.relative(".", process.argv[2])}`
	)
} catch (e) {
	console.error("Cannot open configuration file ")
	process.exit(-1)
}

String.prototype.replaceAll = function(search, replacement) {
    var target = this;
    return target.split(search).join(replacement);
};

configuration.path = configuration.path.replaceAll("$HOME", process.env.USERPROFILE || process.env.HOME).replaceAll("/", path.sep).replaceAll("\\", path.sep)

async.each(
	configuration.subs,
	function(sub, callbackSub) {
		sub.count = sub.count || 100
		sub.sort 	= sub.sort || "new"
		sub.query = sub.query || "self"

		console.log(`trying to get ${sub.count} from ${sub.name} sorting by ${sub.sort} using query ${sub.query}`)
		getImageLinks(sub.name, sub.query, sub.count, sub.sort, (links) => {
			async.forEach(links,
				function(link, callbackLink) {
					downloadToFile(
						configuration.includeSubName ? path.join(configuration.path, sub.name) : configuration.path, 
						link, 
						callbackLink
					)
				},
				function() {
					callbackSub()
				}
			)
		})
	},
	function() {
		process.exit(0)
	}
)

