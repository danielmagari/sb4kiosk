const $     = id         => document.getElementById(id)
const log   = (...args)  => $("log").innerText += "\n" + args.join(" ")
const now   = ()         => BigInt(Date.now()) / 1000n
const sleep = ms         => new Promise(wake => setTimeout(wake, ms))
const GET   = async url  => await (await fetch(url)).json()
const POST  = (url, obj) => fetch(url, {
  method:  "POST",
  headers: { "Content-Type": "application/json" },
  body:    JSON.stringify(obj, null, 1)
})

// Loading, populating, ready, checking, mining, cancelling, posting, confirming, confirmed, unconfirmed
let state = "loading"

// Step 1) Load the form with data derived from the private key in session storage
async function loadForm () {
  if (state !== "loading") return
  state = "populating"
  try {
    log("Getting your node from local storage...")
    const node = localStorage.getItem("node")
    if (!node)                                                    throw Error("Your node URL isn't in local storage")
    log(node)
    log("OK")

    log("Getting your private key from session storage...")
    const pri = sessionStorage.getItem("pri")
    if (!pri)                                                     throw Error("Your private key isn't in session storage")
    log("OK")

    log("Self-checking your private/public key...")
    await sodium.ready
    if (!/^[0-9a-f]{64}$/.test(pri))                              throw Error("Your private key isn't 256-bit hexadecimal")
    const pri_bin          = sodium.from_hex(pri)
    const pri_hsh_bin      = sodium.crypto_generichash(32, pri_bin)
    const pri_hsh          = sodium.to_hex(pri_hsh_bin)
    if (pri_hsh.slice(0, 3) === '5b4')                            throw Error("Your private key is actually a public key")
    const pub_bin          = sodium.crypto_sign_seed_keypair(pri_bin).publicKey
    const pub_hsh_bin      = sodium.crypto_generichash(32, pub_bin)
    const pub_hsh          = sodium.to_hex(pub_hsh_bin)
    if (pub_hsh.slice(0, 3) !== '5b4')                            throw Error("Your public key didn't pass the self-check")
    const pub              = sodium.to_hex(pub_bin)
    log("OK")

    // Get balance
    log("Getting your account balance...")
    const kit = await GET(node + "/kit?pub=" + pub)
    if (!kit.protocols.includes("sb4"))                           throw Error("Your node doesn't support the sb4 protocol")
    if (kit.pub !== pub)                                          throw Error("Your node returned the wrong public key")
    const kit_now = BigInt(kit.now)
    if (now() < kit_now - 5n || kit_now + 5n < now())             throw Error("Your clock out of sync with your node")
    const balance = BigInt(kit.balance)
    log("OK")

    // Put the data in the form
    log("Putting data in form...")
    $("form")    .hidden = false
    $("node")    .value = node
    $("pri_fake").value = "(loaded in session storage)"
    $("pri")     .value = pri
    $("pub")     .value = pub
    $("balance") .value = balance
    log("OK")

    state = "ready"
    checkForm()
  } catch (error) {
    console.error(error)
    alert(error)
    log(error)
  }
}

// Update the balance displayed after input
function checkForm () {
  if (state !== "ready") return
  state = "checking"
  try {
    $("to_err")   .innerText = ""
    $("to")       .value = $("to").value.trim()
    $("net")      .value = $("net").value.trim()
    $("burn")     .value = ""
    $("gross")    .value = ""
    $("remainder").value = ""
    $("remainder").style.color = ""
    $("to")       .disabled = false
    $("net")      .disabled = false
    $("send")     .disabled = true
    $("cancel")   .disabled = true
    $("view")     .disabled = true

    // Show remaining balance calculation when net amount is input
    let net_ok = false
    const net_str = $("net").value
    if (net_str && /^[1-9][0-9]{0,11}$/.test(net_str)) {
      const net = BigInt(net_str)

      const balance   = BigInt($("balance").value)
      const gross     = net + 100n
      const remainder = balance - gross
      net_ok = remainder >= 0n

      $("burn")     .value = 100
      $("gross")    .value = gross
      $("remainder").value       = net_ok ? remainder : "(nsf)"
      $("remainder").style.color = net_ok ? ""        : "red"
    } else {
      $("net").value = ""
    }

    // Show results of self-check when receiver's public key is input
    let to_ok = false
    const to_str = $("to").value
    if (to_str && /^[0-9a-f]{1,64}$/.test(to_str)) {
      if (to_str.length < 64) {
        $("to_err").innerText = "(incomplete public key)"
      } else {
        const to         = to_str
        const to_bin     = sodium.from_hex(to)
        const to_hsh_bin = sodium.crypto_generichash(32, to_bin)
        const to_hsh     = sodium.to_hex(to_hsh_bin)
        if (to_hsh.slice(0, 3) !== '5b4') {
          $("to_err").innerText = "(doesn't pass self-check)"
        } else {
          to_ok = true
        }
      }
    } else {
      $("to").value = ""
    }

    // Show send button iff net amount and receiver's public key are good
    if (net_ok && to_ok) $("send").disabled = false
    state = "ready"
  } catch (error) {
    console.error(error)
    alert(error)
    log(error)
  }
}

loadForm()

function cancelForm () {
  if (state !== "mining") return
  log("Setting cancel flag...")
  state = "cancelling"
  $("cancel").disabled = true
  log("OK")
}

// Commit to the (assumed valid) form
async function sendTransaction () {
  try {
    if (state !== "ready") return
    state = "mining"
    $("to")    .disabled = true
    $("net")   .disabled = true
    $("send")  .disabled = true
    $("cancel").disabled = false
    $("view")  .disabled = true

    log("Getting node from local storage...")
    const node = localStorage.getItem("node")
    if (!node)                                                    throw Error("CANCELLED\nYou don't have a node in local storage")
    if (node !== $("node").value)                                 throw Error("CANCELLED\nStale node - refresh the page")
    log(node)
    log("OK")

    log("Getting your private key from session storage...")
    const pri = sessionStorage.getItem("pri")
    if (!pri)                                                     throw Error("CANCELLED\nYou don't have a private key in session storage")
    if (pri !== $("pri").value)                                   throw Error("CANCELLED\nStale private key - refresh the page")
    log("OK")

    log("Self-checking your private and public key...")
    if (!/^[0-9a-f]{64}$/.test(pri))                              throw Error("CANCELLED\nYour private key isn't 256-bit hexadecimal")
    const pri_bin           = sodium.from_hex(pri)
    const pri_hsh_bin       = sodium.crypto_generichash(32, pri_bin)
    const pri_hsh           = sodium.to_hex(pri_hsh_bin)
    if (pri_hsh.slice(0, 3) === '5b4')                            throw Error("CANCELLED\nYour private key is actually a public key")
    const pub_bin           = sodium.crypto_sign_seed_keypair(pri_bin).publicKey
    const pub               = sodium.to_hex(pub_bin)
    if (pub !== $("pub").value)                                   throw Error("CANCELLED\nStale public key - refresh the page")
    const pub_hsh_bin       = sodium.crypto_generichash(32, pub_bin)
    const pub_hsh           = sodium.to_hex(pub_hsh_bin)
    if (pub_hsh.slice(0, 3) !== '5b4')                            throw Error("CANCELLED\nYour public key doesn't pass the self-check")
    log("OK")

    log("Self-checking the receiver's public key...")
    const to = $("to").value
    if (!to)                                                      throw Error("CANCELLED\nThe receiver's public key isn't specified")
    if (!/^[0-9a-f]{64}$/.test(to))                               throw Error("CANCELLED\nThe receiver's public key isn't 256-bit hexadecimal")
    const to_bin            = sodium.from_hex(to)
    const to_hsh_bin        = sodium.crypto_generichash(32, to_bin)
    const to_hsh            = sodium.to_hex(to_hsh_bin)
    if (to_hsh.slice(0, 3) !== '5b4')                             throw Error("CANCELLED\nThe receiver's public key doesn't pass the self-check")
    log("OK")

    log("Validating the amount sent...")
    const net_str = $("net").value
    if (!net_str)                                                 throw Error("CANCELLED\nYou didn't specifiy a net amount to send")
    if (!/^[1-9][0-9]{0,11}$/.test(net_str))                      throw Error("CANCELLED\nYour net amount to send isn't a valid number")
    const net = BigInt(net_str)
    const gross = net + 100n
    log("Gross", gross)
    log("OK")

    log("Getting user confirmation...")
    if (state !== "mining")                                       throw Error("You cancelled the transaction before it was sent")
    const sure = confirm("Are you sure that you want to send " + net + " coins to " + to + "?")
    if (!sure)                                                    throw Error("You weren't sure that you wanted to send the transaction")
    log("OK")

    log("Getting server status...")
    const status = await GET(node + "/status")
    log(JSON.stringify(status, null, 1))
    if (!status.protocols.includes('sb4'))                        throw Error("CANCELLED\nThe node doesn't support the sb4 protocol")
    if (state !== "mining")                                       throw Error("You cancelled the transaction before it was sent")
    log("OK")

    log("Calculating primetime wait...")
    const primetime      = BigInt(status.creation) + 30n * (BigInt(status.height) + 1n) + 10n
    const primetime_wait = BigInt(status.now) - primetime
    log(primetime_wait)
    log("OK")

    log("Waiting for primetime...")
    for (let i = 0n; i < primetime_wait; i++) {
      if (state !== "mining")                                     throw Error("You cancelled the transaction before it was sent")
      log(primetime_wait - i)
      await sleep(1000)
    }
    log("OK")

    log("Getting mining kit...")
    const kit = await GET(node + "/kit?pub=" + pub)
    log(JSON.stringify(kit, null, 1))
    if (state === "cancelling")                                   throw Error("You cancelled the transaction before it was sent")
    log("OK")

    log("Choosing tip block relationship...")
    const now      = BigInt(kit.now)
    const creation = BigInt(kit.creation)
    const height   = BigInt(kit.height)
    const max_height = (now - creation) / 30n
    if (height > max_height)                                      throw Error("CANCELLED\nThe node's blockchain is too high somehow!?")
    const at_max_height = height === max_height
    const parent        =        at_max_height ? kit.parent        : kit.tip
    const balance       = BigInt(at_max_height ? kit.parentBalance : kit.balance)
    if (at_max_height && kit.conflict !== "0")                    throw Error("CANCELLED\nYou have a conflicting transaction in this block")
    log(at_max_height ? "(merging with tip)" : "(mining new tip)")
    log("OK")

    log("Checking balance...")
    if (balance < gross)                                          throw Error("CANCELLED\nYou have an insufficient balance")
    log("OK")

    log("Making new transaction...")
    const tx = {
      parent: parent,
      from:   pub,
      to:     to,
      gross:  '' + gross,
    }
    log(JSON.stringify(tx, null, 1))
    log("OK")

    log("Signing transaction...")
    const tx_str      = JSON.stringify(tx)
    const pri_ext_bin = sodium.crypto_sign_seed_keypair(pri_bin).privateKey
    const sig_bin     = sodium.crypto_sign_detached(tx_str, pri_ext_bin)
    const sig         = sodium.to_hex(sig_bin)
    tx.sig = sig
    log(sig.slice(0, 64))
    log(sig.slice(64))
    log("OK")

    log("Mining tip block...")
    delete tx.parent
    const tip = {
      parent: parent,
      txs:    [tx],
      bans:   []
    }
    log(JSON.stringify(tip, null, 1))
    log("OK")

    log("Posting tip block...")
    if (state !== "mining")                                       throw Error("You cancelled the transaction before it was sent")
    state = "posting"
    $("cancel").disabled = true
    const post_response = await POST(node + "/tip", tip)
    state = "confirming"
    if (!post_response.ok)                                        throw Error("UNKNOWN IF SENT\nThe node didn't respond 200 OK to your posted tip block")
    log("OK")

    log("Confirming transaction...")
    state = "confirming"
    let limit = 5
    for (let i = 1; i <= limit; i++) {
      await sleep(i * 250)
      const block = await GET(node + "/block?parent=" + parent)
      if (!block) {
        log("Attempt " + i + ": Block not found")
        continue
      }
      if (block.txs.some(tx => tx.sig === sig)) {
        state = "confirmed"
        log  ("Transaction confirmed!")
        alert("Transaction confirmed!")
        break
      }
      if (block.bans.some(ban => ban.from === pub)) {
        state = "banned"
        log  ("Something went horribly wrong. You got banned!")
        alert("Something went horribly wrong. You got banned!")
        break
      }
      log("Attempt " + i + ": Block found, but transaction not confirmed")
      if (i === limit) {
        if (confirm("The server hasn't confirmed your transaction yet. Maybe it's orphaned. Keep checking?")) {
          limit++
          continue
        }
        state = "unconfirmed"
        log  ("Transaction not confirmed")
        alert("Transaction not confirmed, but you can click on the View button to keep checking.")
      }
    }
    log("OK")

    log("Showing link to block...")
    $("view").disabled = false
    $("view").onclick = () => {
      $("to") .value = ""
      $("net").value = ""
      location = "block.html?parent=" + parent
    }
    log("OK")
  } catch (error) {
    console.error(error)
    alert(error)
    log(error)
    state = "ready"
    checkForm()
  }
}
