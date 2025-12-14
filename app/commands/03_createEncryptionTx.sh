#!/usr/bin/env bash
set -euo pipefail

# SET UP VARS HERE
source ../.env


PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# get params
${cli} conway query protocol-parameters ${network} --out-file ./tmp/protocol.json

# alice
alice_wallet_path="../wallets/alice"
alice_address=$(cat ${alice_wallet_path}/payment.addr)
alice_pkh=$(${cli} conway address key-hash --payment-verification-key-file ${alice_wallet_path}/payment.vkey)

# collat wallet
collat_wallet_path="../wallets/collat"
collat_address=$(cat ${collat_wallet_path}/payment.addr)
collat_pkh=$(${cli} conway address key-hash --payment-verification-key-file ${collat_wallet_path}/payment.vkey)

# stake key
stake_key=$(jq -r '.stake_key' ../config.json)

# encryption
encryption_script_path="../contracts/contracts/encryption_contract.plutus"
encryption_script_address=$(${cli} conway address build --payment-script-file ${encryption_script_path} --stake-key-hash ${stake_key} ${network})
encryption_pid=$(cat ../contracts/hashes/encryption.hash)

echo -e "\033[0;36m Gathering Alice UTxO Information  \033[0m"
${cli} conway query utxo \
    ${network} \
    --address ${alice_address} \
    --out-file ./tmp/alice_utxo.json
TXNS=$(jq length ./tmp/alice_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${alice_address} \033[0m \n";
   exit;
fi
TXIN=$(jq -r --arg alltxin "" 'keys[] | . + $alltxin + " --tx-in"' ./tmp/alice_utxo.json)
alice_utxo=${TXIN::-8}

# find token name from inputs
first_utxo=$(jq -r 'keys[0]' ./tmp/alice_utxo.json)

string=${first_utxo}
IFS='#' read -ra array <<< "$string"

tx_idx_cbor=$(../venv/bin/python -c "import cbor2;encoded=cbor2.dumps(${array[1]});print(encoded.hex())")
full_tkn="${tx_idx_cbor}${array[0]}"
token_name="${full_tkn:0:64}"
encryption_asset="1 ${encryption_pid}.${token_name}"
echo -e "\033[1;36m\nEncryption Token: ${encryption_asset} \033[0m"

# encrypt the message
secret_message="This is a secret message."

# generate the register
PYTHONPATH="$PROJECT_ROOT" \
"$PROJECT_ROOT/venv/bin/python" -c \
"
from src.constants import KEY_DOMAIN_TAG, H1, H2, H3
from src.files import extract_key
from src.bls12381 import to_int, rng, random_fq12, scale, g1_point, combine
from src.hashing import generate
from src.register import Register
from src.ecies import encrypt, capsule_to_file
from src.level import half_level_to_file

# these are secrets
a0 = rng()
r0 = rng()
m0 = random_fq12(a0)

key = extract_key('${alice_wallet_path}/payment.skey');
sk = to_int(generate(KEY_DOMAIN_TAG + key))
user = Register(x=sk)
user.to_file()

r1b = scale(g1_point(1), r0)
r2_g1b = scale(g1_point(1), a0 + r0*sk)

c0 = combine(combine(H1, H2), H3)
r4b = scale(c0, r0)

half_level_to_file(r1b, r2_g1b, r4b)

nonce, aad, ct = encrypt(r1b, m0, '${secret_message}')
capsule_to_file(nonce, aad, ct)
"

jq \
--arg alice_pkh "${alice_pkh}" \
--arg token_name "${token_name}" \
--argjson register "$(cat ../data/register.json)" \
--argjson capsule "$(cat ../data/capsule.json)" \
--argjson half_level "$(cat ../data/half-level.json)" \
'.fields[0].bytes=$alice_pkh |
.fields[1]=$register |
.fields[2].bytes=$token_name |
.fields[3].list=[$half_level] |
.fields[4]=$capsule' \
../data/encryption/encryption-datum.json | sponge ../data/encryption/encryption-datum.json