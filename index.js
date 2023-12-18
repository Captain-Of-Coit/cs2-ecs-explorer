let timeout = null

document.querySelector('#search').addEventListener('keyup', e => {
    const text = e.target.value.trim()
    if (timeout) {
        clearTimeout(timeout)
    }
    timeout = setTimeout(() => {
        document.querySelector('#loading').style.opacity = 1.0
        timeout = null
        window.location.hash = 'system/' + text
    }, 300)
})

async function main(type = 'system', search_string = '') {
    const el = document.querySelector('#graph')
    const $sidebar = document.querySelector('#sidebar')
    const $loading = document.querySelector('#loading')

    if (el) {
        document.body.removeChild(el)
    }

    let path = type === 'system' ? './data/Systems.json' : './data/Components.json'

    const res = await window.fetch(path)
    let data = await res.json()

    let is_exact_match = false

    function flattenHierarchy(data) {
        let nodes = []
        let links = []
        let namespaceSet = new Set()
    
        Object.keys(data).forEach(systemName => {
            if (!systemName.toLowerCase().includes(search_string.toLowerCase())) {
                const has_uses_system = !!data[systemName].uses_system
                const uses_system = has_uses_system ? data[systemName].uses_system.filter(s => s.toLowerCase().includes(search_string.toLowerCase())) : []

                const has_used_in_system = !!data[systemName].used_in_system
                const used_in_system = has_used_in_system ? data[systemName].used_in_system.filter(s => s.toLowerCase().includes(search_string.toLowerCase())) : []

                if (uses_system.length === 0 && used_in_system.length === 0) {
                    return
                }
            }
            
            const system = data[systemName]
            const exactMatch = system.name.toLowerCase() === search_string.toLowerCase()

            if (exactMatch) {
                is_exact_match = data[systemName]

                if (type === 'component') {
                    system.used_in_system.forEach((usedInName) => {
                        nodes.push({
                            id: usedInName,
                            type: 'system'
                        })
                        links.push({ source: usedInName, target: systemName, type: 'used_by' })
                    })
                }
            }
            
            nodes.push({
                id: systemName,
                fixed: exactMatch,
                type: type,
            })

            const parts = systemName.split('.')
            parts.forEach((part, index) => {
                let currentNamespace = parts.slice(0, index + 1).join('.')
                if (!namespaceSet.has(currentNamespace)) {
                    namespaceSet.add(currentNamespace)
                }
            })

            system.uses_system ? system.uses_system.forEach(target => {
                if (namespaceSet.has(target)) {
                    links.push({ source: systemName, target: target, type: 'uses' })
                }
            }) : null

            system.used_in_system ? system.used_in_system.forEach(source => {
                if (namespaceSet.has(source)) {
                    links.push({ source: source, target: systemName, type: 'used_by' })
                }
            }) : null
        })
    
        return { nodes, links }
    }
    
    let { nodes, links } = flattenHierarchy(data)

    nodes.forEach(node => {
        if (node.fixed) {
            node.fx = window.innerWidth / 2
            node.fy = window.innerHeight / 2
        }
    })

    if (is_exact_match) {
        const $container = document.createElement('div')

        const $title = document.createElement('h2')
        $title.innerText = is_exact_match.name

        $container.appendChild($title)

        
        if (is_exact_match.properties && is_exact_match.properties.length > 0) {
            const $used = document.createElement('h4')
            $used.innerText = 'Properties'
            $container.appendChild($used)

            is_exact_match.properties.forEach((property) => {
                const el = document.createElement('div')
                const {visibility, type, name} = property
                el.innerText = visibility + ' ' + type + ' ' + name
                $container.appendChild(el)
            })
        }

        if (is_exact_match.componentTypes && is_exact_match.componentTypes.length > 0) {
            const $components_title = document.createElement('h4')
            $components_title.innerText = 'Used Components'
            $container.appendChild($components_title)
            
            is_exact_match.componentTypes.forEach((component) => {
                const el = document.createElement('a')
                el.innerText = component
                el.href = '#component/' + component
                $container.appendChild(el)
            })
        }

        if (is_exact_match.uses_system && is_exact_match.uses_system.length > 0) {
            const $uses_title = document.createElement('h4')
            $uses_title.innerText = 'Uses Systems'
            $container.appendChild($uses_title)
            
            is_exact_match.uses_system.forEach((component) => {
                const el = document.createElement('a')
                el.innerText = component
                el.href = '#system/' + component
                $container.appendChild(el)
            })
        }

        if (is_exact_match.used_in_system && is_exact_match.used_in_system.length > 0) {
            const $used = document.createElement('h4')
            $used.innerText = 'Systems Used By'
            $container.appendChild($used)

            is_exact_match.used_in_system.forEach((component) => {
                const el = document.createElement('a')
                el.innerText = component
                el.href = '#system/' + component
                $container.appendChild(el)
            })
        }

        console.log('match', is_exact_match)

        // Debug output
        // $container.innerHTML = `<pre>${JSON.stringify(is_exact_match, null, 2)}</pre>`

        console.log('adding', $container)
        $sidebar.appendChild($container)
    }

    const defaultDistance = 100
    const maxDistance = 100000

    function linkDistanceSquare(link) {
        const sourceConnections = connectionCount[link.source.id] || 1
        const targetConnections = connectionCount[link.target.id] || 1
        const totalConnections = sourceConnections + targetConnections
        return Math.min(defaultDistance * Math.sqrt(totalConnections), maxDistance)
    }

    function linkDistanceLog(link) {
        const sourceConnections = connectionCount[link.source.id] || 1
        const targetConnections = connectionCount[link.target.id] || 1
        const totalConnections = sourceConnections + targetConnections
        return Math.min(defaultDistance * Math.log(totalConnections + 1), maxDistance)
    }
    
    let connectionCount = {}
    links.forEach(link => {
        connectionCount[link.source] = (connectionCount[link.source] || 0) + 1
        connectionCount[link.target] = (connectionCount[link.target] || 0) + 1
    })

    console.log('nodes', nodes)
    console.log('links', links)
    console.log('connectionCount', connectionCount)

    const simulation = d3.forceSimulation()
        .force('link', d3.forceLink().id(d => d.id).distance(link => linkDistanceSquare(link)).strength(0.5))
        .force('charge', d3.forceManyBody().strength(-600))
        .force('center', d3.forceCenter(window.innerWidth / 2, window.innerHeight / 2))
        .force('collide', d3.forceCollide().radius(300).strength(1.0))

    // Wrap the renderGraph in a setTimeout so it ends up after the opacity change in the event loop
    $loading.style.opacity = '1.0'
    setTimeout(() => {
        renderGraph(nodes, links, simulation)
    }, 0)

    function renderGraph(nodes, links, simulation) {
        d3.select('svg').remove()

        const zoom = d3.zoom().on('zoom', event => {
            graphGroup.attr('transform', event.transform)
        })

        const svg = d3.select('body').append('svg')
            .attr('width', window.innerWidth)
            .attr('height', window.innerHeight)
            .attr('id', 'graph')
            .call(zoom)

        svg.append('defs').selectAll('marker')
            .data(['uses', 'used_by'])
            .enter().append('marker')
            .attr('id', d => `arrow-${d}`)
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 15)
            .attr('refY', 0)
            .attr('markerWidth', 12)
            .attr('markerHeight', 12)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            // .attr('fill', d => d === 'uses' ? 'red' : 'green')
            .attr('fill', 'green')

        const graphGroup = svg.append('g')

        const link = graphGroup.append('g')
            .attr('stroke', '#999')
            .selectAll('line')
            .data(links)
            .join('line')
            .attr('stroke-width', d => d.type === 'uses' ? 2 : 2)
            // .style('stroke', d => d.type === 'uses' ? 'red' : 'green')
            .attr('stroke', 'green')
            .attr('marker-end', d => `url(#arrow-${d.type})`)

        const nodeGroup = graphGroup.append('g')
            .selectAll('g')
            .data(nodes)
            .join('g')

        nodeGroup.append('circle')
            .attr('r', 15)
            .attr('fill', d => d.type === 'system' ? 'blue' : 'yellow')

        const padding = { top: 5, right: 10, bottom: 5, left: 10 }
        const textElements = nodeGroup.append('text')
            .text(d => d.id)
            .attr('x', 30)
            .style('font-size', '16px')
            .style('fill', 'white')
            .each(function() {
                const bbox = this.getBBox()
                const rectHeight = bbox.height + padding.top + padding.bottom
                const rectY = -rectHeight / 2 + bbox.height / 2
                d3.select(this.parentNode).insert('rect', 'text')
                    .attr('x', bbox.x - padding.left)
                    .attr('y', rectY - 5)
                    .attr('width', bbox.width + padding.left + padding.right)
                    .attr('height', rectHeight)
                    .attr('fill', 'rgba(0,0,0,0.8)')
                d3.select(this).attr('y', rectY + rectHeight / 2 + bbox.height / 2)
            })

        textElements.attr('y', d => (padding.top + 10) - 5)

        nodeGroup.on('click', (ev, d) => {
            if (ev.ctrlKey) {
                nodes = nodes.filter(node => node.id !== d.id)
                links = links.filter(link => link.source.id !== d.id && link.target.id !== d.id)
                renderGraph(nodes, links, simulation)
            } else {
                console.log(d)
                window.location.hash = 'system/' + d.id
            }
        })

        simulation.nodes(nodes).on('tick', () => {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y)
            nodeGroup.attr('transform', d => `translate(${d.x},${d.y})`)
        })

        simulation.force('link').links(links)
        simulation.restart()

        function zoomToFit(minX, minY, maxX, maxY) {
            const padding = 150
            minX -= padding
            minY -= padding
            maxX += padding
            maxY += padding
    
            const width = maxX - minX
            const height = maxY - minY
            const midX = (maxX + minX) / 2
            const midY = (maxY + minY) / 2
            const scale = Math.min(window.innerWidth / width, window.innerHeight / height)
            const translate = [window.innerWidth / 2 - scale * midX, window.innerHeight / 2 - scale * midY]
    
            svg.transition()
                .duration(500)
                .call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale))
        }
    
        simulation.on('end', () => {
            let minX = d3.min(nodes, d => d.x)
            let minY = d3.min(nodes, d => d.y)
            let maxX = d3.max(nodes, d => d.x)
            let maxY = d3.max(nodes, d => d.y)
            zoomToFit(minX, minY, maxX, maxY)
            $loading.style.opacity = 0.0
        })
    
        const n = Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay())) / 1.01
        for (let i = 0; i < n; ++i) {
            simulation.tick()
        }
    }
}

function readHash() {
    const hash = window.location.hash.substring(1)
    const splitted = hash.split('/') // first part is type, second part is identifier
    if (splitted.length > 1) {
        return splitted
    } else {
        return ['system', '']
    }
}

window.addEventListener('hashchange', () => {
    document.querySelector('#loading').style.opacity = 1.0
    const [type, id] = readHash()
    document.querySelector('#sidebar').innerHTML = ''
    document.querySelector('#search').value = id
    main(type, id)
})

const [type, id] = readHash()
main(type, id)
document.querySelector('#search').value = id