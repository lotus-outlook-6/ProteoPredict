import urllib.request
import json

url = "https://search.rcsb.org/rcsbsearch/v2/query"
data = {
    "query": {
        "type": "terminal",
        "service": "sequence",
        "parameters": {
            "evalue_cutoff": 0.1,
            "identity_cutoff": 0.9,
            "sequence_type": "protein",
            "value": "MVLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHFDLSHGSAQVKGHGKKVADALTNAVAHVDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTPAVHASLDKFLASVSTVLTSKYR"
        }
    },
    "return_type": "entry"
}

req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(req) as response:
        print(response.read().decode('utf-8'))
except Exception as e:
    print("Error:", e)
